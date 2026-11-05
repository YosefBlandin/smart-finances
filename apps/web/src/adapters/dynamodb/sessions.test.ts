import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessions, newCookieId, sessionIdHash } from '@/application/session';
import type { IdentityFailure, IdentityProvider, Tokens } from '@/ports/identity-provider';
import type { PreAuthRow } from '@/ports/pre-auth-store';
import type { SessionRow } from '@/ports/session-store';
import { MemoryClock } from '../memory/clock';
import { MemoryIdentityProvider } from '../memory/identity-provider';
import { MemoryPreAuthStore } from '../memory/pre-auth-store';
import { MemorySessionStore } from '../memory/session-store';
import { DynamoPreAuthStore, DynamoSessionStore, type DocClient } from './sessions';

// Synthetic values only: example.test addresses, made-up subs and tokens, a fake table. No AWS call is made: every
// adapter here gets a hand-written fake document client.
const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = 1_790_000_000_000;
const TABLE = 'sessions-test';
const SUB_A = '00000000-0000-4000-8000-000000000001';
const SUB_B = '00000000-0000-4000-8000-000000000002';
const EMAIL = 'person@example.test';

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims: object) => `${b64url({ alg: 'none' })}.${b64url(claims)}.c2ln`;
const tokensFor = (sub: string, expiresAt: number, tag = '1'): Tokens => ({
  access: jwt({ sub, exp: Math.floor(expiresAt / 1000), token_use: 'access', n: tag }),
  id: jwt({ sub, email: EMAIL, token_use: 'id', n: tag }),
  refresh: `refresh-${sub}-${tag}`,
  expiresAt,
});

type Item = Record<string, unknown>;
type Sent = { name: string; input: Item };

// A hand-written fake of the DynamoDB document client: one table with a bySub index (keys only), no TTL sweeper
// (expired items stay until something deletes them, as DynamoDB's TTL may lag by days). It understands exactly the
// expressions the adapter writes and throws on anything else, so a changed expression fails loudly.
class FakeTable implements DocClient {
  readonly items = new Map<string, Item>();
  readonly sent: Sent[] = [];
  failNext?: string;

  async send(command: { input: object }) {
    const name = command.constructor.name;
    const input = structuredClone(command.input) as Item;
    this.sent.push({ name, input });
    if (this.failNext) {
      const e = new Error('fake service error');
      e.name = this.failNext;
      this.failNext = undefined;
      throw e;
    }
    expect(input.TableName).toBe(TABLE);
    const key = (input.Key as { pk: string } | undefined)?.pk;
    switch (name) {
      case 'GetCommand': {
        const item = this.items.get(key!);
        return { Item: item && structuredClone(item) };
      }
      case 'PutCommand': {
        const item = input.Item as Item;
        this.condition(input, this.items.get(item.pk as string));
        this.items.set(item.pk as string, structuredClone(item));
        return {};
      }
      case 'DeleteCommand':
        this.items.delete(key!);
        return {};
      case 'UpdateCommand': {
        const item = this.items.get(key!);
        this.condition(input, item);
        const names = input.ExpressionAttributeNames as Record<string, string>;
        const values = (input.ExpressionAttributeValues ?? {}) as Item;
        const m = /^(?:SET (.+?))?(?: ?REMOVE (.+))?$/.exec(input.UpdateExpression as string);
        if (!m) throw new Error(`fake: unknown update ${String(input.UpdateExpression)}`);
        const next = { ...item };
        for (const part of m[1]?.split(', ') ?? []) {
          const [n, v] = part.split(' = ');
          next[names[n!]!] = values[v!];
        }
        for (const n of m[2]?.split(', ') ?? []) delete next[names[n]!];
        this.items.set(key!, next);
        return {};
      }
      case 'QueryCommand': {
        expect(input.IndexName).toBe('bySub');
        expect(input.KeyConditionExpression).toBe('#sub = :sub');
        const sub = (input.ExpressionAttributeValues as Item)[':sub'];
        const all = [...this.items.values()].filter((i) => i.sub === sub).sort((a, b) => String(a.pk).localeCompare(String(b.pk)));
        // Pages of two, to prove the adapter follows LastEvaluatedKey; the index projects keys only.
        const start = input.ExclusiveStartKey ? all.findIndex((i) => i.pk === (input.ExclusiveStartKey as Item).pk) + 1 : 0;
        const page = all.slice(start, start + 2).map((i) => ({ pk: i.pk, sub: i.sub }));
        const more = start + 2 < all.length;
        return { Items: page, LastEvaluatedKey: more ? { pk: page[page.length - 1]!.pk, sub } : undefined };
      }
      default:
        throw new Error(`fake: unexpected ${name}`);
    }
  }

  private condition(input: Item, item: Item | undefined) {
    const expr = input.ConditionExpression as string | undefined;
    if (!expr) return;
    const values = (input.ExpressionAttributeValues ?? {}) as Item;
    let pass: boolean;
    if (expr === 'attribute_exists(pk)') pass = !!item;
    else if (expr === 'attribute_exists(pk) AND expires_at > :now') pass = !!item && (item.expires_at as number) > (values[':now'] as number);
    else throw new Error(`fake: unknown condition ${expr}`);
    if (!pass) {
      const e = new Error('The conditional request failed');
      e.name = 'ConditionalCheckFailedException';
      throw e;
    }
  }

  names() {
    return this.sent.map((s) => s.name);
  }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function sessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  const t = tokensFor(SUB_A, T0 + HOUR);
  return {
    idHash: sha256('cookie-a'),
    sub: SUB_A,
    accessToken: t.access,
    idToken: t.id,
    refreshToken: t.refresh,
    createdAt: T0,
    lastSeenAt: T0,
    expiresAt: T0 + 12 * HOUR,
    ...overrides,
  };
}

function preAuthRow(overrides: Partial<PreAuthRow> = {}): PreAuthRow {
  return {
    idHash: sha256('pre-a'),
    step: 'confirm',
    email: EMAIL,
    emailHash: 'aGFzaC1vZi10aGUtZW1haWw',
    acceptedVersions: { terms: '2026-11-01', privacy: '2026-11-01' },
    lang: 'es',
    attempts: 0,
    expiresAt: T0 + 15 * MIN,
    ...overrides,
  };
}

describe('T-WAUTH-3 the DynamoDB session store (Contracts "Sessions table")', () => {
  let table: FakeTable;
  let clock: MemoryClock;
  let store: DynamoSessionStore;
  beforeEach(() => {
    table = new FakeTable();
    clock = new MemoryClock(T0);
    store = new DynamoSessionStore({ client: table, tableName: TABLE, clock });
  });

  it('T-WAUTH-3 writes pk SID#<sha256>, snake_case fields and expires_at in epoch seconds for the TTL', async () => {
    const row = sessionRow();
    await store.create(row);
    const put = table.sent[0]!;
    expect(put.name).toBe('PutCommand');
    expect(put.input.Item).toEqual({
      pk: `SID#${row.idHash}`,
      sub: SUB_A,
      access_token: row.accessToken,
      id_token: row.idToken,
      refresh_token: row.refreshToken,
      created_at: T0,
      last_seen_at: T0,
      expires_at: (T0 + 12 * HOUR) / 1000,
    });
    expect(row.idHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('T-WAUTH-3 reads with a consistent read and maps the row back; an absent row is undefined', async () => {
    const row = sessionRow();
    await store.create(row);
    expect(await store.get(row.idHash)).toEqual(row);
    expect(table.sent[1]).toEqual({ name: 'GetCommand', input: { TableName: TABLE, Key: { pk: `SID#${row.idHash}` }, ConsistentRead: true } });
    expect(await store.get(sha256('other'))).toBeUndefined();
  });

  it('T-WAUTH-3 a row past expires_at that the TTL has not removed reads as missing', async () => {
    const row = sessionRow({ expiresAt: T0 + 10 * MIN });
    await store.create(row);
    clock.set(T0 + 10 * MIN);
    expect(await store.get(row.idHash)).toBeUndefined();
    expect(await store.touch(row.idHash, T0 + 10 * MIN)).toBe(false);
  });

  it('T-WAUTH-3 a pre-auth row is never read as a session, and a malformed item is refused', async () => {
    const pre = new DynamoPreAuthStore({ client: table, tableName: TABLE, clock });
    await pre.create(preAuthRow({ idHash: sha256('cookie-a') }));
    expect(await store.get(sha256('cookie-a'))).toBeUndefined();
    table.items.set(`SID#${sha256('broken')}`, { pk: `SID#${sha256('broken')}`, sub: SUB_A, expires_at: T0 / 1000 + 600 });
    expect(await store.get(sha256('broken'))).toBeUndefined();
  });

  it('T-WAUTH-3 touch moves last_seen_at only on a live row', async () => {
    const row = sessionRow();
    await store.create(row);
    expect(await store.touch(row.idHash, T0 + 5 * MIN)).toBe(true);
    const update = table.sent.find((s) => s.name === 'UpdateCommand')!;
    expect(update.input).toMatchObject({
      Key: { pk: `SID#${row.idHash}` },
      ConditionExpression: 'attribute_exists(pk) AND expires_at > :now',
    });
    expect((await store.get(row.idHash))?.lastSeenAt).toBe(T0 + 5 * MIN);
    expect(await store.touch(sha256('gone'), T0)).toBe(false);
    expect(table.items.has(`SID#${sha256('gone')}`)).toBe(false);
  });

  it('T-WAUTH-3 listBySub and deleteBySub use the bySub index, follow its pages and touch only that person', async () => {
    for (const id of ['a', 'b', 'c']) await store.create(sessionRow({ idHash: sha256(id) }));
    await store.create(sessionRow({ idHash: sha256('d'), sub: SUB_B }));
    // An expired row of the same person: listed rows are live only, but delete removes it too.
    await store.create(sessionRow({ idHash: sha256('e'), expiresAt: T0 + MIN }));
    clock.set(T0 + 2 * MIN);
    const mine = await store.listBySub(SUB_A);
    expect(mine.map((r) => r.idHash).sort()).toEqual([sha256('a'), sha256('b'), sha256('c')].sort());
    const queries = table.sent.filter((s) => s.name === 'QueryCommand');
    expect(queries.length).toBeGreaterThan(1);
    expect(queries[0]!.input).toMatchObject({
      IndexName: 'bySub',
      ExpressionAttributeNames: { '#sub': 'sub' },
      ExpressionAttributeValues: { ':sub': SUB_A },
    });

    expect(await store.deleteBySub(SUB_A)).toBe(4);
    expect([...table.items.keys()]).toEqual([`SID#${sha256('d')}`]);
  });

  it('T-WAUTH-3 delete removes the one row by its hashed key', async () => {
    const row = sessionRow();
    await store.create(row);
    await store.delete(row.idHash);
    expect(table.sent.at(-1)).toEqual({ name: 'DeleteCommand', input: { TableName: TABLE, Key: { pk: `SID#${row.idHash}` } } });
    expect(table.items.size).toBe(0);
  });

  it('T-WAUTH-3 a service error is not swallowed as a missing row', async () => {
    table.failNext = 'ProvisionedThroughputExceededException';
    await expect(store.get(sha256('x'))).rejects.toThrow();
    table.failNext = 'InternalServerError';
    await expect(store.touch(sha256('x'), T0)).rejects.toThrow();
  });
});

describe('T-WAUTH-4 the DynamoDB pre-auth store (Contracts "Sessions table")', () => {
  let table: FakeTable;
  let clock: MemoryClock;
  let store: DynamoPreAuthStore;
  beforeEach(() => {
    table = new FakeTable();
    clock = new MemoryClock(T0);
    store = new DynamoPreAuthStore({ client: table, tableName: TABLE, clock });
  });

  it('T-WAUTH-4 writes pk PRE#<sha256> with snake_case fields and maps them back', async () => {
    const row = preAuthRow({ challengeSession: 'challenge-session-1', totpSecret: 'JBSWY3DPEHPK3PXP' });
    await store.create(row);
    expect(table.sent[0]!.input.Item).toEqual({
      pk: `PRE#${row.idHash}`,
      step: 'confirm',
      email: EMAIL,
      email_hash: row.emailHash,
      challenge_session: 'challenge-session-1',
      totp_secret: 'JBSWY3DPEHPK3PXP',
      accepted_versions: { terms: '2026-11-01', privacy: '2026-11-01' },
      lang: 'es',
      attempts: 0,
      expires_at: (T0 + 15 * MIN) / 1000,
    });
    expect(await store.get(row.idHash)).toEqual(row);
    // Optional fields that are absent are not written.
    await store.create(preAuthRow({ idHash: sha256('pre-b'), acceptedVersions: undefined }));
    expect(table.items.get(`PRE#${sha256('pre-b')}`)).not.toHaveProperty('accepted_versions');
    expect(await store.get(sha256('pre-b'))).toEqual(preAuthRow({ idHash: sha256('pre-b'), acceptedVersions: undefined }));
  });

  it('T-WAUTH-4 an expired row reads as missing and cannot be updated', async () => {
    const row = preAuthRow();
    await store.create(row);
    clock.set(T0 + 15 * MIN);
    expect(await store.get(row.idHash)).toBeUndefined();
    expect(await store.update(row.idHash, { step: 'code' })).toBe(false);
  });

  it('T-WAUTH-4 update sets the given fields, removes the ones set to undefined, and never resurrects a row', async () => {
    const row = preAuthRow({ totpSecret: 'JBSWY3DPEHPK3PXP' });
    await store.create(row);
    expect(await store.update(row.idHash, { step: 'code', attempts: 2, challengeSession: 'next', totpSecret: undefined })).toBe(true);
    expect(await store.get(row.idHash)).toEqual({ ...row, step: 'code', attempts: 2, challengeSession: 'next', totpSecret: undefined });
    expect(table.items.get(`PRE#${row.idHash}`)).not.toHaveProperty('totp_secret');
    await store.delete(row.idHash);
    expect(await store.update(row.idHash, { step: 'code' })).toBe(false);
    expect(table.items.size).toBe(0);
  });

  it('T-WAUTH-4 an empty patch writes nothing', async () => {
    await store.create(preAuthRow());
    const before = table.sent.length;
    expect(await store.update(preAuthRow().idHash, {})).toBe(true);
    expect(table.sent.slice(before).map((s) => s.name)).toEqual(['GetCommand']);
  });
});

// A fake identity provider that records refresh, revoke and global sign-out, and answers refresh from a script.
class RecordingIdp extends MemoryIdentityProvider {
  readonly calls: string[] = [];
  refreshReply: { ok: true; tokens: Tokens } | { ok: false; reason: IdentityFailure } = { ok: false, reason: 'revoked' };
  async refresh(sub: string, refreshToken: string) {
    this.calls.push(`refresh ${sub} ${refreshToken}`);
    return this.refreshReply;
  }
  async revoke(refreshToken: string) {
    this.calls.push(`revoke ${refreshToken}`);
    return { ok: true as const };
  }
  async adminGlobalSignOut(sub: string) {
    this.calls.push(`globalSignOut ${sub}`);
    return { ok: true as const };
  }
}

// The use cases run over both the DynamoDB adapter (fake table, no TTL sweeps) and the memory adapter.
const backends = [
  [
    'dynamodb',
    (clock: MemoryClock, table = new FakeTable()) => ({
      table,
      sessionStore: new DynamoSessionStore({ client: table, tableName: TABLE, clock }),
      preAuthStore: new DynamoPreAuthStore({ client: table, tableName: TABLE, clock }),
    }),
  ],
  [
    'memory',
    (clock: MemoryClock) => ({ table: undefined, sessionStore: new MemorySessionStore(clock), preAuthStore: new MemoryPreAuthStore(clock) }),
  ],
] as const;

describe.each(backends)('T-WAUTH-3 T-WAUTH-4 application/session.ts over the %s adapter', (_name, make) => {
  let clock: MemoryClock;
  let idp: RecordingIdp;
  let s: ReturnType<typeof createSessions>;
  let stores: ReturnType<typeof make>;
  beforeEach(() => {
    clock = new MemoryClock(T0);
    idp = new RecordingIdp(clock);
    stores = make(clock);
    s = createSessions({ sessionStore: stores.sessionStore, preAuthStore: stores.preAuthStore, identityProvider: idp as IdentityProvider, clock });
  });

  it('T-WAUTH-3 cookie ids are 32 random bytes in base64url and the row key is their sha256, never the id', async () => {
    const id = newCookieId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(id, 'base64url')).toHaveLength(32);
    expect(sessionIdHash(id)).toBe(sha256(id));
    const { id: sid } = await s.createSession({ sub: SUB_A, tokens: tokensFor(SUB_A, T0 + HOUR) });
    expect(await stores.sessionStore.get(sha256(sid))).toBeDefined();
    if (stores.table) {
      expect([...stores.table.items.keys()]).toEqual([`SID#${sha256(sid)}`]);
      expect(JSON.stringify([...stores.table.items.values()])).not.toContain(sid);
    }
  });

  it('T-WAUTH-3 getSession reads the person from the row and the id token, and touches it', async () => {
    const { id } = await s.createSession({ sub: SUB_A, tokens: tokensFor(SUB_A, T0 + HOUR) });
    clock.advance(10 * MIN);
    const session = await s.getSession(id);
    expect(session).toMatchObject({ sub: SUB_A, email: EMAIL, createdAt: T0, lastSeenAt: T0 + 10 * MIN, expiresAt: T0 + 12 * HOUR });
    expect(session?.accessToken).toBe(tokensFor(SUB_A, T0 + HOUR).access);
    expect(session).not.toHaveProperty('refreshToken');
    expect((await stores.sessionStore.get(sha256(id)))?.lastSeenAt).toBe(T0 + 10 * MIN);
  });

  it('T-WAUTH-3 no cookie, a malformed cookie or an unknown id is no session', async () => {
    expect(await s.getSession(undefined)).toBeNull();
    expect(await s.getSession('not a cookie id')).toBeNull();
    expect(await s.readSession(newCookieId())).toEqual({ status: 'none' });
  });

  it('T-WAUTH-3 30 idle minutes refuse a row the TTL has not removed, and the row is deleted', async () => {
    const { id } = await s.createSession({ sub: SUB_A, tokens: tokensFor(SUB_A, T0 + HOUR) });
    clock.advance(29 * MIN);
    expect(await s.getSession(id)).not.toBeNull();
    clock.advance(30 * MIN);
    expect(await s.readSession(id)).toEqual({ status: 'idle' });
    expect(await stores.sessionStore.get(sha256(id))).toBeUndefined();
  });

  it('T-WAUTH-3 12 hours refuse a session in use all along', async () => {
    const { id } = await s.createSession({ sub: SUB_A, tokens: tokensFor(SUB_A, T0 + HOUR) });
    for (let t = 20 * MIN; t < 12 * HOUR; t += 20 * MIN) {
      clock.set(T0 + t);
      expect(await s.getSession(id), `at ${t / MIN} minutes`).not.toBeNull();
    }
    clock.set(T0 + 12 * HOUR);
    const read = await s.readSession(id);
    expect(read.status === 'expired' || read.status === 'none').toBe(true);
    expect(await s.getSession(id)).toBeNull();
  });

  it('T-WAUTH-3 a stale row with a far expires_at is still refused by the policy itself', async () => {
    const id = newCookieId();
    await stores.sessionStore.create(sessionRow({ idHash: sha256(id), expiresAt: T0 + 100 * HOUR }));
    clock.set(T0 + 12 * HOUR);
    expect(await s.readSession(id)).toEqual({ status: 'expired' });
    expect(await stores.sessionStore.get(sha256(id))).toBeUndefined();
  });

  it('T-WAUTH-3 a new session id at every sign-in; the previous session and the pre-auth row are removed', async () => {
    const pre = await s.startPreAuth({ step: 'code', email: EMAIL, emailHash: 'aGFzaA', lang: 'en' });
    const first = await s.createSession({ sub: SUB_A, tokens: tokensFor(SUB_A, T0 + HOUR), preAuthId: pre.id });
    expect(await s.readPreAuth(pre.id)).toBeNull();
    expect(await stores.preAuthStore.get(sha256(pre.id))).toBeUndefined();
    const second = await s.createSession({ sub: SUB_A, tokens: tokensFor(SUB_A, T0 + HOUR), previousSessionId: first.id });
    expect(second.id).not.toBe(first.id);
    expect(await s.getSession(first.id)).toBeNull();
    expect(await s.getSession(second.id)).not.toBeNull();
  });

  it('T-WAUTH-3 refreshIfNeeded keeps a token with 5 minutes or more left', async () => {
    const { id } = await s.createSession({ sub: SUB_A, tokens: tokensFor(SUB_A, T0 + 5 * MIN) });
    const session = (await s.getSession(id))!;
    expect(await s.refreshIfNeeded(session)).toEqual(session);
    expect(idp.calls).toEqual([]);
  });

  it('T-WAUTH-3 refreshIfNeeded refreshes with the sub under 5 minutes left and stores the new tokens', async () => {
    const { id } = await s.createSession({ sub: SUB_A, tokens: tokensFor(SUB_A, T0 + HOUR) });
    clock.advance(28 * MIN);
    await s.getSession(id);
    clock.advance(28 * MIN);
    const session = (await s.getSession(id))!;
    const fresh = tokensFor(SUB_A, T0 + 2 * HOUR, '2');
    idp.refreshReply = { ok: true, tokens: fresh };
    const next = await s.refreshIfNeeded(session);
    expect(idp.calls).toEqual([`refresh ${SUB_A} refresh-${SUB_A}-1`]);
    expect(next).toMatchObject({ sub: SUB_A, accessToken: fresh.access, idToken: fresh.id, createdAt: T0, expiresAt: T0 + 12 * HOUR });
    const row = await stores.sessionStore.get(sha256(id));
    expect(row).toMatchObject({ accessToken: fresh.access, refreshToken: fresh.refresh, createdAt: T0, expiresAt: T0 + 12 * HOUR });
  });

  it('T-WAUTH-3 a refused refresh ends the session; a failed one keeps a still-valid token', async () => {
    const { id } = await s.createSession({ sub: SUB_A, tokens: tokensFor(SUB_A, T0 + 3 * MIN) });
    const session = (await s.getSession(id))!;
    idp.refreshReply = { ok: false, reason: 'failed' };
    expect(await s.refreshIfNeeded(session)).toEqual(session);
    clock.advance(3 * MIN);
    expect(await s.refreshIfNeeded(session)).toBeNull();
    expect(await stores.sessionStore.get(sha256(id))).toBeDefined();
    idp.refreshReply = { ok: false, reason: 'revoked' };
    expect(await s.refreshIfNeeded(session)).toBeNull();
    expect(await stores.sessionStore.get(sha256(id))).toBeUndefined();
  });

  it('T-WAUTH-3 refresh does not bring back a session signed out meanwhile', async () => {
    const { id } = await s.createSession({ sub: SUB_A, tokens: tokensFor(SUB_A, T0 + MIN) });
    const session = (await s.getSession(id))!;
    await s.endSession(id);
    idp.refreshReply = { ok: true, tokens: tokensFor(SUB_A, T0 + HOUR, '2') };
    expect(await s.refreshIfNeeded(session)).toBeNull();
    expect(await stores.sessionStore.get(sha256(id))).toBeUndefined();
  });

  it('T-WAUTH-3 endSession deletes the row and revokes its refresh token', async () => {
    const { id } = await s.createSession({ sub: SUB_A, tokens: tokensFor(SUB_A, T0 + HOUR) });
    await s.endSession(id);
    expect(await s.getSession(id)).toBeNull();
    expect(idp.calls).toEqual([`revoke refresh-${SUB_A}-1`]);
    await s.endSession(id);
    await s.endSession(undefined);
    expect(idp.calls).toHaveLength(1);
  });

  it("T-WAUTH-3 signOutEverywhere(sub) signs the person out at the pool and removes every row of theirs, no one else's", async () => {
    const a1 = await s.createSession({ sub: SUB_A, tokens: tokensFor(SUB_A, T0 + HOUR) });
    const a2 = await s.createSession({ sub: SUB_A, tokens: tokensFor(SUB_A, T0 + HOUR) });
    const b = await s.createSession({ sub: SUB_B, tokens: tokensFor(SUB_B, T0 + HOUR) });
    expect(await s.signOutEverywhere(SUB_A)).toEqual({ ok: true, removed: 2 });
    expect(idp.calls).toEqual([`globalSignOut ${SUB_A}`]);
    expect(await s.getSession(a1.id)).toBeNull();
    expect(await s.getSession(a2.id)).toBeNull();
    expect(await s.getSession(b.id)).not.toBeNull();
    if (stores.table) {
      const names = stores.table.names();
      expect(names.indexOf('QueryCommand')).toBeGreaterThan(-1);
    }
  });

  it('T-WAUTH-4 a pre-auth row gets a fresh id, attempts 0 and 15 minutes; the previous one is replaced', async () => {
    const first = await s.startPreAuth({ step: 'confirm', email: EMAIL, emailHash: 'aGFzaA', lang: 'es' });
    expect(first.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.row).toMatchObject({ idHash: sha256(first.id), step: 'confirm', attempts: 0, expiresAt: T0 + 15 * MIN });
    expect(await s.readPreAuth(first.id)).toEqual(first.row);
    const second = await s.startPreAuth({ step: 'password', email: EMAIL, emailHash: 'aGFzaA', lang: 'es' }, first.id);
    expect(second.id).not.toBe(first.id);
    expect(await s.readPreAuth(first.id)).toBeNull();
    expect(await s.readPreAuth(second.id)).not.toBeNull();
  });

  it('T-WAUTH-4 pre-auth rows expire after 15 minutes, even when updated along the way', async () => {
    const { id } = await s.startPreAuth({ step: 'password', email: EMAIL, emailHash: 'aGFzaA', lang: 'en' });
    clock.advance(10 * MIN);
    expect(await s.updatePreAuth(id, { step: 'code', challengeSession: 'challenge-1', expiresAt: T0 + 99 * HOUR } as never)).toBe(true);
    expect(await s.readPreAuth(id)).toMatchObject({ step: 'code', challengeSession: 'challenge-1', expiresAt: T0 + 15 * MIN });
    clock.set(T0 + 15 * MIN - 1);
    expect(await s.readPreAuth(id)).not.toBeNull();
    clock.set(T0 + 15 * MIN);
    expect(await s.readPreAuth(id)).toBeNull();
    expect(await s.updatePreAuth(id, { step: 'code' })).toBe(false);
  });

  it('T-WAUTH-4 a stale pre-auth row the TTL has not removed is refused and deleted', async () => {
    const id = newCookieId();
    await stores.preAuthStore.create(preAuthRow({ idHash: sha256(id), expiresAt: T0 + 15 * MIN }));
    clock.set(T0 + 16 * MIN);
    expect(await s.readPreAuth(id)).toBeNull();
    expect(await s.readPreAuth('malformed')).toBeNull();
    expect(await s.readPreAuth(undefined)).toBeNull();
    await s.endPreAuth(id);
  });
});

// app/cookies.ts with next/headers replaced by a recording jar.
const jar = vi.hoisted(() => {
  const set: [string, string, object][] = [];
  const values = new Map<string, string>();
  return {
    set,
    values,
    api: {
      get: (name: string) => (values.has(name) ? { name, value: values.get(name)! } : undefined),
      set: (name: string, value: string, options: object) => {
        set.push([name, value, options]);
      },
    },
  };
});
vi.mock('next/headers', () => ({ cookies: async () => jar.api }));

describe('T-WAUTH-3 T-WAUTH-4 app/cookies.ts sets the cookies per contract', () => {
  afterEach(() => {
    jar.set.length = 0;
    jar.values.clear();
  });

  it('T-WAUTH-3 __Host-sid: Secure, HttpOnly, SameSite=Lax, Path=/, no Max-Age; cleared with Max-Age 0', async () => {
    const cookies = await import('@/app/cookies');
    const id = newCookieId();
    await cookies.setSessionCookie(id);
    expect(jar.set).toEqual([['__Host-sid', id, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' }]]);
    jar.values.set('__Host-sid', id);
    expect(await cookies.readSessionCookie()).toBe(id);
    jar.values.set('__Host-sid', 'tampered value');
    expect(await cookies.readSessionCookie()).toBeUndefined();
    await cookies.clearSessionCookie();
    expect(jar.set[1]).toEqual(['__Host-sid', '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 }]);
  });

  it('T-WAUTH-4 __Host-pre: Secure, HttpOnly, SameSite=Strict, Path=/, Max-Age 900; cleared with Max-Age 0', async () => {
    const cookies = await import('@/app/cookies');
    const id = newCookieId();
    await cookies.setPreAuthCookie(id);
    expect(jar.set).toEqual([['__Host-pre', id, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 900 }]]);
    jar.values.set('__Host-pre', id);
    expect(await cookies.readPreAuthCookie()).toBe(id);
    expect(await cookies.readSessionCookie()).toBeUndefined();
    await cookies.clearPreAuthCookie();
    expect(jar.set[1]).toEqual(['__Host-pre', '', { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 0 }]);
  });
});
