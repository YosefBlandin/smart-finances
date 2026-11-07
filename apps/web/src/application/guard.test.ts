/* eslint-disable import/no-restricted-paths -- T-WAUTH-13 drives the guard over the memory adapters (the STAGE=test
   container), the DynamoDB accounts adapter over a fake client, and guarded()'s money kind in app/; this is the task's one
   test file. No production application code imports adapters or app. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { getContainer, memoryContainer, TEST_PERSON, type Container } from '@/adapters/container';
import { DynamoAccountStore } from '@/adapters/dynamodb/accounts';
import type { DocClient } from '@/adapters/dynamodb/sessions';
import { MemoryClock } from '@/adapters/memory/clock';
import { TEST_AUTHENTICATOR_CODE, TEST_EMAIL_CODE, type MemoryIdentityProvider } from '@/adapters/memory/identity-provider';
import type { MemoryLogger } from '@/adapters/memory/logger';
import { TEST_SETTINGS } from '@/adapters/memory/settings';
import { createGuarded } from '@/app/guarded';
import { createConfirm } from '@/application/auth/confirm';
import { createSignIn } from '@/application/auth/signIn';
import { createSignUp } from '@/application/auth/signUp';
import { createSessions } from '@/application/session';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/legal/versions';
import type { Account, AccountStore, Consent } from '@/ports/account-store';
import type { Tokens } from '@/ports/identity-provider';
import { CURRENT_VERSIONS, createGuard } from './guard';

// T-WAUTH-13 (AC-14, D-87, D-145, D-108): no money route answers without a consent row at the current terms and privacy
// versions and an active account; the consent comes from the pre-auth row at the first completed sign-in, the consent
// screen asks for the current versions, refusing signs out, and resetStoredBytes keeps the consent. Synthetic values
// only: example.test addresses, made-up subs and tokens, a fake table; no AWS call is made.

const START = Date.UTC(2026, 10, 4, 10, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const SUB = '00000000-0000-4000-8000-0000000000a1';
const EMAIL = 'person@example.test';
const PASSWORD = 'correct horse battery staple';
const OLD = '2026-01-01';

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims: object) => `${b64url({ alg: 'none' })}.${b64url(claims)}.c2ln`;
const tokensFor = (sub: string, now: number): Tokens => ({
  access: jwt({ sub, exp: Math.floor((now + HOUR) / 1000), token_use: 'access' }),
  id: jwt({ sub, email: EMAIL, token_use: 'id' }),
  refresh: `refresh-${sub}`,
  expiresAt: now + HOUR,
});

const consent = (over: Partial<Consent> = {}): Consent => ({
  termsVersion: TERMS_VERSION,
  privacyVersion: PRIVACY_VERSION,
  lang: 'en',
  acceptedAt: START,
  ...over,
});

function setup() {
  const clock = new MemoryClock(START);
  const container: Container = memoryContainer(undefined, clock);
  const sleep = async (ms: number) => clock.advance(ms);
  const deps = { ...container, sleep };
  const sessions = createSessions(container);
  const guard = createGuard(container);
  const signIn = async (sub = SUB) => (await sessions.createSession({ sub, tokens: tokensFor(sub, clock.now()) })).id;
  return { clock, container, deps, sessions, guard, signIn, logger: container.logger as MemoryLogger };
}

describe('T-WAUTH-13: requireMoneyAccess needs a session, the current consent and an active account', () => {
  it('T-WAUTH-13: the current versions are the legal ones', () => {
    expect(CURRENT_VERSIONS).toEqual({ terms: TERMS_VERSION, privacy: PRIVACY_VERSION });
  });

  it('T-WAUTH-13: no cookie, an unknown id or an idle session is signed out', async () => {
    const t = setup();
    expect(await t.guard.requireMoneyAccess(undefined)).toEqual({ ok: false, reason: 'signed-out', why: 'none' });
    expect(await t.guard.requireMoneyAccess('x'.repeat(43))).toEqual({ ok: false, reason: 'signed-out', why: 'none' });
    const id = await t.signIn();
    await t.container.accountStore.putConsent(SUB, consent());
    t.clock.advance(31 * MIN);
    expect(await t.guard.requireMoneyAccess(id)).toEqual({ ok: false, reason: 'signed-out', why: 'idle' });
  });

  it('T-WAUTH-13: a session with no account row goes to consent', async () => {
    const t = setup();
    const id = await t.signIn();
    expect(await t.guard.requireMoneyAccess(id)).toEqual({ ok: false, reason: 'consent' });
  });

  it('T-WAUTH-13: an older terms version or an older privacy version goes to consent', async () => {
    const t = setup();
    const id = await t.signIn();
    await t.container.accountStore.putConsent(SUB, consent({ termsVersion: OLD }));
    expect(await t.guard.requireMoneyAccess(id)).toEqual({ ok: false, reason: 'consent' });
    await t.container.accountStore.putConsent(SUB, consent({ privacyVersion: OLD }));
    expect(await t.guard.requireMoneyAccess(id)).toEqual({ ok: false, reason: 'consent' });
  });

  it('T-WAUTH-13: the current consent and an active account open the money screens with the session and the account', async () => {
    const t = setup();
    const id = await t.signIn();
    await t.container.accountStore.putConsent(SUB, consent());
    const access = await t.guard.requireMoneyAccess(id);
    expect(access.ok).toBe(true);
    if (!access.ok) return;
    expect(access.session).toMatchObject({ sub: SUB, email: EMAIL });
    expect(access.account).toMatchObject({ sub: SUB, status: 'active', consent: consent() });
  });

  it('T-WAUTH-13: an account marked deleting is refused unless the caller allows deleting', async () => {
    const t = setup();
    const id = await t.signIn();
    await t.container.accountStore.putConsent(SUB, consent());
    await t.container.accountStore.markDeleting(SUB, START);
    expect(await t.guard.requireMoneyAccess(id)).toEqual({ ok: false, reason: 'deleting' });
    const allowed = await t.guard.requireMoneyAccess(id, { allowDeleting: true });
    expect(allowed.ok && allowed.account.status).toBe('deleting');
  });

  it('T-WAUTH-13: a refused token refresh ends the session', async () => {
    const t = setup();
    // A token with no exp is due for refresh; the fake pool does not know this refresh token, so it is refused.
    const { id } = await t.sessions.createSession({ sub: SUB, tokens: { access: 'opaque', id: 'opaque', refresh: 'unknown', expiresAt: 0 } });
    await t.container.accountStore.putConsent(SUB, consent());
    expect(await t.guard.requireMoneyAccess(id)).toEqual({ ok: false, reason: 'signed-out', why: 'expired' });
    expect(await t.sessions.getSession(id)).toBeNull();
  });
});

describe('T-WAUTH-13: the STAGE=test person', () => {
  it('T-WAUTH-13: under STAGE=test the shared container holds one signed-in person with the current consent', async () => {
    const shared = Symbol.for('smart-finances.container');
    const g = globalThis as Record<symbol, unknown>;
    delete g[shared];
    vi.stubEnv('STAGE', 'test');
    try {
      const access = await createGuard(getContainer()).requireMoneyAccess(TEST_PERSON.sessionId);
      expect(access.ok).toBe(true);
      if (!access.ok) return;
      expect(access.session).toMatchObject({ sub: TEST_PERSON.sub, email: TEST_PERSON.email });
      expect(access.account.consent).toMatchObject({ termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION });
    } finally {
      delete g[shared];
    }
  });
});

describe('T-WAUTH-13: the consent screen asks for the current versions; refusing signs out', () => {
  it('T-WAUTH-13: consentView says what the screen shows', async () => {
    const t = setup();
    expect(await t.guard.consentView(undefined)).toEqual({ status: 'signed-out', why: 'none' });
    const id = await t.signIn();
    expect(await t.guard.consentView(id)).toEqual({ status: 'needed', changed: false, versions: CURRENT_VERSIONS });
    await t.container.accountStore.putConsent(SUB, consent({ privacyVersion: OLD }));
    expect(await t.guard.consentView(id)).toEqual({ status: 'needed', changed: true, versions: CURRENT_VERSIONS });
    await t.container.accountStore.putConsent(SUB, consent());
    expect(await t.guard.consentView(id)).toEqual({ status: 'current' });
  });

  it('T-WAUTH-13: accepting the current versions records them with the language and time, and opens the money screens', async () => {
    const t = setup();
    const id = await t.signIn();
    await t.container.accountStore.putConsent(SUB, consent({ termsVersion: OLD, acceptedAt: START - HOUR }));
    t.clock.advance(MIN);
    expect(await t.guard.acceptConsent(id, CURRENT_VERSIONS, 'es')).toEqual({ ok: true });
    expect((await t.container.accountStore.getAccount(SUB))?.consent).toEqual(consent({ lang: 'es', acceptedAt: START + MIN }));
    expect((await t.guard.requireMoneyAccess(id)).ok).toBe(true);
  });

  it('T-WAUTH-13: accepting versions that are no longer current records nothing', async () => {
    const t = setup();
    const id = await t.signIn();
    expect(await t.guard.acceptConsent(id, { terms: OLD, privacy: PRIVACY_VERSION }, 'en')).toEqual({ ok: false, reason: 'changed' });
    expect(await t.container.accountStore.getAccount(SUB)).toBeUndefined();
  });

  it('T-WAUTH-13: accepting without a session, or for an account marked deleting, records nothing', async () => {
    const t = setup();
    expect(await t.guard.acceptConsent(undefined, CURRENT_VERSIONS, 'en')).toEqual({ ok: false, reason: 'signed-out' });
    const id = await t.signIn();
    await t.container.accountStore.markDeleting(SUB, START);
    expect(await t.guard.acceptConsent(id, CURRENT_VERSIONS, 'en')).toEqual({ ok: false, reason: 'deleting' });
    expect((await t.container.accountStore.getAccount(SUB))?.consent).toBeUndefined();
  });

  it('T-WAUTH-13: refusing signs out: the session row goes and its refresh token is revoked', async () => {
    const t = setup();
    const id = await t.signIn();
    const revoked: string[] = [];
    t.container.identityProvider.revoke = async (token: string) => {
      revoked.push(token);
      return { ok: true as const };
    };
    await t.guard.declineConsent(id, { requestId: 'req-1' });
    expect(await t.sessions.getSession(id)).toBeNull();
    expect(revoked).toEqual([`refresh-${SUB}`]);
    expect(t.logger.events).toContainEqual({ name: 'signout', outcome: 'consent_declined', sub: SUB, requestId: 'req-1' });
    expect(await t.container.accountStore.getAccount(SUB)).toBeUndefined();
  });
});

describe('T-WAUTH-13: the first completed sign-in writes the consent from the pre-auth row', () => {
  async function signUpAndIn(t: ReturnType<typeof setup>, lang: 'en' | 'es' = 'es', versions = CURRENT_VERSIONS) {
    const signUp = createSignUp({ ...t.deps, versions });
    const { confirm } = createConfirm(t.deps);
    const signIn = createSignIn(t.deps);
    const up = await signUp({ email: EMAIL, password: PASSWORD, accepted: true, lang }, { requestId: 'r' });
    if (!up.ok) throw new Error('sign-up refused');
    await confirm({ code: TEST_EMAIL_CODE }, { requestId: 'r', preAuthId: up.data.preAuthId });
    const ctx = { requestId: 'r', ip: '192.0.2.10', lang };
    const pw = await signIn.signIn(EMAIL, PASSWORD, { ...ctx, preAuthId: up.data.preAuthId });
    if (!pw.ok) throw new Error('password refused');
    const done = await signIn.verifySetup(TEST_AUTHENTICATOR_CODE, { ...ctx, preAuthId: pw.data.preAuthId });
    if (!done.ok || !('sessionId' in done.data)) throw new Error('setup refused');
    return done.data;
  }

  it('T-WAUTH-13: sign-up, confirm and the first sign-in record the accepted versions, language and time', async () => {
    const t = setup();
    const { sessionId, sub } = await signUpAndIn(t);
    const account = await t.container.accountStore.getAccount(sub);
    expect(account?.status).toBe('active');
    expect(account?.consent).toMatchObject({ termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, lang: 'es' });
    expect(account?.consent?.acceptedAt).toBeGreaterThanOrEqual(START);
    expect((await t.guard.requireMoneyAccess(sessionId)).ok).toBe(true);
  });

  it('T-WAUTH-13: versions accepted at sign-up that are no longer current are recorded, and the consent screen asks again', async () => {
    const t = setup();
    const { sessionId, sub } = await signUpAndIn(t, 'en', { terms: OLD, privacy: PRIVACY_VERSION });
    expect((await t.container.accountStore.getAccount(sub))?.consent?.termsVersion).toBe(OLD);
    expect(await t.guard.requireMoneyAccess(sessionId)).toEqual({ ok: false, reason: 'consent' });
  });

  it('T-WAUTH-13: a sign-in with no accepted versions in its pre-auth row records no consent', async () => {
    const t = setup();
    const idp = t.container.identityProvider as MemoryIdentityProvider;
    await idp.signUp(EMAIL, PASSWORD, 'en');
    await idp.confirm(EMAIL, TEST_EMAIL_CODE);
    const signIn = createSignIn(t.deps);
    const ctx = { requestId: 'r', ip: '192.0.2.10', lang: 'en' as const };
    const pw = await signIn.signIn(EMAIL, PASSWORD, ctx);
    if (!pw.ok) throw new Error('password refused');
    const done = await signIn.verifySetup(TEST_AUTHENTICATOR_CODE, { ...ctx, preAuthId: pw.data.preAuthId });
    if (!done.ok || !('sessionId' in done.data)) throw new Error('setup refused');
    expect(await t.container.accountStore.getAccount(done.data.sub)).toBeUndefined();
    expect(await t.guard.requireMoneyAccess(done.data.sessionId)).toEqual({ ok: false, reason: 'consent' });
  });

  it('T-WAUTH-13: an existing consent is not overwritten by a later sign-in', async () => {
    const t = setup();
    const { sub } = await signUpAndIn(t);
    const before = (await t.container.accountStore.getAccount(sub))?.consent;
    await t.container.accountStore.putConsent(sub, { ...before!, acceptedAt: START - HOUR });
    // A second sign-up row for the same email would carry versions again; the account already has a consent.
    const signIn = createSignIn(t.deps);
    const ctx = { requestId: 'r', ip: '192.0.2.10', lang: 'en' as const };
    const pw = await signIn.signIn(EMAIL, PASSWORD, ctx);
    if (!pw.ok) throw new Error('password refused');
    await signIn.verifyCode(TEST_AUTHENTICATOR_CODE, { ...ctx, preAuthId: pw.data.preAuthId });
    expect((await t.container.accountStore.getAccount(sub))?.consent?.acceptedAt).toBe(START - HOUR);
  });
});

describe('T-WAUTH-13: guarded() kind "money" runs requireMoneyAccess before the input', () => {
  const ORIGIN = TEST_SETTINGS.WEB_ORIGIN;
  const schema = z.object({ amount: z.string().regex(/^\d+$/) });

  function money(opts: { allowDeleting?: boolean } = {}) {
    const t = setup();
    const cookie: { id?: string } = {};
    const origin = { value: ORIGIN };
    const g = createGuarded({
      headers: async () => new Headers({ origin: origin.value }),
      container: () => t.container,
      sessionId: async () => cookie.id,
    });
    const calls: unknown[] = [];
    const action = g(schema, { kind: 'money', ...opts }, async (input, ctx) => {
      calls.push({ input, sub: ctx.session?.sub, status: ctx.account?.status });
      return { ok: true, data: null };
    });
    return { ...t, cookie, origin, action, calls };
  }

  it('T-WAUTH-13: without a session the action never runs and the input is not read', async () => {
    const m = money();
    expect(await m.action({ amount: 'not a number' })).toEqual({ ok: false, messageKey: 'auth.sessionEnded' });
    expect(m.calls).toEqual([]);
  });

  it('T-WAUTH-13: without the current consent the action never runs, even with bad input', async () => {
    const m = money();
    m.cookie.id = await m.signIn();
    expect(await m.action({ amount: 'not a number' })).toEqual({ ok: false, messageKey: 'auth.consentNeeded' });
    await m.container.accountStore.putConsent(SUB, consent({ termsVersion: OLD }));
    expect(await m.action({ amount: '12' })).toEqual({ ok: false, messageKey: 'auth.consentNeeded' });
    expect(m.calls).toEqual([]);
  });

  it('T-WAUTH-13: with the current consent the input is checked, then the action runs with the session and account', async () => {
    const m = money();
    m.cookie.id = await m.signIn();
    await m.container.accountStore.putConsent(SUB, consent());
    expect(await m.action({ amount: 'not a number' })).toEqual({ ok: false, messageKey: 'auth.invalid' });
    expect(await m.action({ amount: '12' })).toEqual({ ok: true, data: null });
    expect(m.calls).toEqual([{ input: { amount: '12' }, sub: SUB, status: 'active' }]);
  });

  it('T-WAUTH-13: the Origin is still checked first, and a deleting account passes only with allowDeleting', async () => {
    const m = money();
    m.cookie.id = await m.signIn();
    await m.container.accountStore.putConsent(SUB, consent());
    m.origin.value = 'https://evil.example.test';
    expect(await m.action({ amount: '12' })).toEqual({ ok: false, messageKey: 'auth.forbidden' });
    m.origin.value = ORIGIN;
    await m.container.accountStore.markDeleting(SUB, START);
    expect(await m.action({ amount: '12' })).toEqual({ ok: false, messageKey: 'auth.forbidden' });
    expect(m.calls).toEqual([]);

    const d = money({ allowDeleting: true });
    d.cookie.id = await d.signIn();
    await d.container.accountStore.putConsent(SUB, consent());
    await d.container.accountStore.markDeleting(SUB, START);
    expect(await d.action({ amount: '12' })).toEqual({ ok: true, data: null });
    expect(d.calls).toEqual([{ input: { amount: '12' }, sub: SUB, status: 'deleting' }]);
  });
});

// --- The accounts table adapter -----------------------------------------------------------------------------------

const TABLE = 'accounts-test';
type Item = Record<string, unknown>;
type Sent = { name: string; input: Item };

// A hand-written fake of the DynamoDB document client for the accounts table. It understands exactly the update and
// condition expressions the adapter writes (each implemented here by hand) and throws on anything else, so a changed
// expression fails loudly. A failed condition throws ConditionalCheckFailedException, like DynamoDB.
class FakeAccounts implements DocClient {
  readonly items = new Map<string, Item>();
  readonly sent: Sent[] = [];
  failNext?: string;
  /** Runs once right before the next update is applied: a concurrent writer. */
  beforeUpdate?: () => void;

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
    const pk = (input.Key as { pk: string }).pk;
    switch (name) {
      case 'GetCommand':
        expect(input.ConsistentRead).toBe(true);
        return { Item: structuredClone(this.items.get(pk)) };
      case 'DeleteCommand':
        this.items.delete(pk);
        return {};
      case 'UpdateCommand':
        this.beforeUpdate?.();
        this.beforeUpdate = undefined;
        this.update(pk, input);
        return {};
      default:
        throw new Error(`unexpected command ${name}`);
    }
  }

  private update(pk: string, input: Item) {
    const names = input.ExpressionAttributeNames as Record<string, string>;
    const v = input.ExpressionAttributeValues as Item;
    const old = this.items.get(pk);
    const item: Item = structuredClone(old) ?? { pk };
    const at = (alias: string) => names[alias]!;
    const today = item[at('#t')] as { day: string; n: number } | undefined;
    const fail = () => {
      const e = new Error('The conditional request failed');
      e.name = 'ConditionalCheckFailedException';
      throw e;
    };
    const cond = input.ConditionExpression as string | undefined;
    const notDeleting = () => item[at('#s')] === undefined || item[at('#s')] !== v[':deleting'];
    switch (cond) {
      case undefined:
        break;
      case 'attribute_exists(pk)':
        if (!old) fail();
        break;
      case '#t.#d = :day AND #t.#n < :perDay AND attribute_not_exists(#r) AND #b <= :room AND (attribute_not_exists(#s) OR #s <> :deleting)':
        if (!old || !today || today.day !== v[':day'] || !(today.n < (v[':perDay'] as number)) || item[at('#r')] !== undefined) fail();
        if (!((item[at('#b')] as number) <= (v[':room'] as number)) || !notDeleting()) fail();
        break;
      case '(attribute_not_exists(#t) OR #t.#d <> :day) AND attribute_not_exists(#r) AND (attribute_not_exists(#b) OR #b <= :room) AND (attribute_not_exists(#s) OR #s <> :deleting)':
        if ((today && today.day === v[':day']) || item[at('#r')] !== undefined) fail();
        if ((item[at('#b')] !== undefined && !((item[at('#b')] as number) <= (v[':room'] as number))) || !notDeleting()) fail();
        break;
      case 'attribute_not_exists(#r)':
        if (item[at('#r')] !== undefined) fail();
        break;
      case '#r = :placeholder':
        if (!old || item[at('#r')] !== v[':placeholder']) fail();
        break;
      case '#r = :id AND #b = :stored':
        if (!old || item[at('#r')] !== v[':id'] || item[at('#b')] !== v[':stored']) fail();
        break;
      case '#r = :id AND #b = :stored AND #t.#d = :day AND #t.#n > :zero':
        if (!old || item[at('#r')] !== v[':id'] || item[at('#b')] !== v[':stored']) fail();
        if (!today || today.day !== v[':day'] || !(today.n > (v[':zero'] as number))) fail();
        break;
      default:
        throw new Error(`unexpected condition ${cond}`);
    }
    const ifNotExists = (alias: string, value: unknown) => (item[at(alias)] === undefined ? value : item[at(alias)]);
    switch (input.UpdateExpression) {
      case 'SET #c = :consent, #s = if_not_exists(#s, :active), #b = if_not_exists(#b, :zero)':
        item[at('#c')] = v[':consent'];
        item[at('#s')] = ifNotExists('#s', v[':active']);
        item[at('#b')] = ifNotExists('#b', v[':zero']);
        break;
      case 'SET #s = :deleting, #ds = if_not_exists(#ds, :now), #b = if_not_exists(#b, :zero)':
        item[at('#s')] = v[':deleting'];
        item[at('#ds')] = ifNotExists('#ds', v[':now']);
        item[at('#b')] = ifNotExists('#b', v[':zero']);
        break;
      case 'SET #b = :zero':
        item[at('#b')] = v[':zero'];
        break;
      case 'SET #t.#n = #t.#n + :one, #r = :id, #rb = :bytes, #b = #b + :bytes':
        today!.n += v[':one'] as number;
        item[at('#r')] = v[':id'];
        item[at('#rb')] = v[':bytes'];
        item[at('#b')] = (item[at('#b')] as number) + (v[':bytes'] as number);
        break;
      case 'SET #t = :today, #r = :id, #rb = :bytes, #b = if_not_exists(#b, :zero) + :bytes, #s = if_not_exists(#s, :active)':
        item[at('#t')] = v[':today'];
        item[at('#r')] = v[':id'];
        item[at('#rb')] = v[':bytes'];
        item[at('#b')] = (ifNotExists('#b', v[':zero']) as number) + (v[':bytes'] as number);
        item[at('#s')] = ifNotExists('#s', v[':active']);
        break;
      case 'SET #r = :id':
        item[at('#r')] = v[':id'];
        break;
      case 'SET #b = :next REMOVE #r, #rb':
        item[at('#b')] = v[':next'];
        delete item[at('#r')];
        delete item[at('#rb')];
        break;
      case 'SET #b = :next, #t.#n = #t.#n - :one REMOVE #r, #rb':
        item[at('#b')] = v[':next'];
        today!.n -= v[':one'] as number;
        delete item[at('#r')];
        delete item[at('#rb')];
        break;
      default:
        throw new Error(`unexpected update ${String(input.UpdateExpression)}`);
    }
    // Every alias and value the request names must be used, as DynamoDB requires.
    const text = `${String(input.UpdateExpression)} ${cond ?? ''}`;
    for (const alias of Object.keys(names)) expect(text, alias).toContain(alias);
    for (const key of Object.keys(v)) expect(text, key).toMatch(new RegExp(`${key}(?![A-Za-z])`));
    this.items.set(pk, item);
  }
}

const MiB = 1024 * 1024;

function dynamo() {
  const client = new FakeAccounts();
  const store: AccountStore = new DynamoAccountStore({ client, tableName: TABLE });
  return { client, store };
}

describe('T-WAUTH-13: the accounts table adapter (DynamoDB, conditional updates)', () => {
  it('T-WAUTH-13: putConsent writes ACCT#<sub> with the consent, active and zero bytes; getAccount reads it back', async () => {
    const { client, store } = dynamo();
    expect(await store.getAccount(SUB)).toBeUndefined();
    await store.putConsent(SUB, consent({ lang: 'es' }));
    expect(client.items.get(`ACCT#${SUB}`)).toEqual({
      pk: `ACCT#${SUB}`,
      consent: { terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION, lang: 'es', accepted_at: START },
      status: 'active',
      stored_bytes: 0,
    });
    expect(await store.getAccount(SUB)).toEqual<Account>({ sub: SUB, consent: consent({ lang: 'es' }), status: 'active', storedBytes: 0 });
  });

  it('T-WAUTH-13: resetStoredBytes keeps the consent (erase-all), and does not create a row', async () => {
    const { client, store } = dynamo();
    await store.resetStoredBytes(SUB);
    expect(client.items.size).toBe(0);
    await store.putConsent(SUB, consent());
    expect(await store.reserveImport(SUB, { day: '2026-11-04', bytes: 5 * MiB, importId: 'imp-1' })).toEqual({ ok: true });
    await store.releaseImport(SUB, 'imp-1', 4 * MiB);
    await store.resetStoredBytes(SUB);
    const account = await store.getAccount(SUB);
    expect(account?.storedBytes).toBe(0);
    expect(account?.consent).toEqual(consent());
    expect(account?.importsToday).toEqual({ day: '2026-11-04', n: 1 });
  });

  it('T-WAUTH-13: resetStoredBytes keeps the consent in the memory adapter too', async () => {
    const { container } = setup();
    await container.accountStore.putConsent(SUB, consent());
    await container.accountStore.reserveImport(SUB, { day: '2026-11-04', bytes: MiB, importId: 'imp-1' });
    await container.accountStore.resetStoredBytes(SUB);
    expect(await container.accountStore.getAccount(SUB)).toMatchObject({ consent: consent(), storedBytes: 0 });
  });

  it('T-WAUTH-13: reserveImport counts imports per day, holds one running import and caps the stored bytes', async () => {
    const { store } = dynamo();
    await store.putConsent(SUB, consent());
    const day = '2026-11-04';
    expect(await store.reserveImport(SUB, { day, bytes: MiB, importId: 'imp-1' })).toEqual({ ok: true });
    expect(await store.reserveImport(SUB, { day, bytes: MiB, importId: 'imp-2' })).toEqual({ ok: false, reason: 'running' });
    await store.releaseImport(SUB, 'imp-1', 2 * MiB);
    expect((await store.getAccount(SUB))?.storedBytes).toBe(2 * MiB);
    expect((await store.getAccount(SUB))?.runningImportId).toBeUndefined();

    for (let i = 2; i <= 10; i += 1) {
      expect(await store.reserveImport(SUB, { day, bytes: 1, importId: `imp-${i}` })).toEqual({ ok: true });
      await store.releaseImport(SUB, `imp-${i}`, 1);
    }
    expect(await store.reserveImport(SUB, { day, bytes: 1, importId: 'imp-11' })).toEqual({ ok: false, reason: 'daily' });
    // A new day starts the count again.
    expect(await store.reserveImport(SUB, { day: '2026-11-05', bytes: 1, importId: 'imp-12' })).toEqual({ ok: true });
    expect((await store.getAccount(SUB))?.importsToday).toEqual({ day: '2026-11-05', n: 1 });
    await store.releaseImport(SUB, 'imp-12', 1);

    const stored = (await store.getAccount(SUB))!.storedBytes;
    expect(await store.reserveImport(SUB, { day: '2026-11-05', bytes: 200 * MiB - stored + 1, importId: 'big' })).toEqual({
      ok: false,
      reason: 'bytes',
    });
    expect(await store.reserveImport(SUB, { day: '2026-11-05', bytes: 201 * MiB, importId: 'huge' })).toEqual({ ok: false, reason: 'bytes' });
    expect(await store.reserveImport(SUB, { day: '2026-11-05', bytes: 200 * MiB - stored, importId: 'fits' })).toEqual({ ok: true });
  });

  it('T-WAUTH-13: reserveImport is one conditional update: a concurrent import that lands first wins', async () => {
    const { client, store } = dynamo();
    await store.putConsent(SUB, consent());
    client.beforeUpdate = () => {
      const item = client.items.get(`ACCT#${SUB}`)!;
      item.running_import_id = 'other';
    };
    expect(await store.reserveImport(SUB, { day: '2026-11-04', bytes: MiB, importId: 'imp-1' })).toEqual({ ok: false, reason: 'running' });
    expect((await store.getAccount(SUB))?.runningImportId).toBe('other');
  });

  it('T-WAUTH-13: releaseImport of another import id changes nothing', async () => {
    const { store } = dynamo();
    await store.putConsent(SUB, consent());
    await store.reserveImport(SUB, { day: '2026-11-04', bytes: MiB, importId: 'imp-1' });
    await store.releaseImport(SUB, 'imp-9', 0);
    expect(await store.getAccount(SUB)).toMatchObject({ runningImportId: 'imp-1', storedBytes: MiB });
  });

  it('T-WAUTH-13: markDeleting keeps the first time; deleteAccountRow removes the row and its consent', async () => {
    const { store } = dynamo();
    await store.putConsent(SUB, consent());
    await store.markDeleting(SUB, START);
    await store.markDeleting(SUB, START + HOUR);
    expect(await store.getAccount(SUB)).toMatchObject({ status: 'deleting', deletingSince: START, consent: consent() });
    await store.deleteAccountRow(SUB);
    expect(await store.getAccount(SUB)).toBeUndefined();
  });

  it('T-WSCR-11: markDeleting is conditional on no running import, and a concurrent reservation that lands first wins', async () => {
    const { client, store } = dynamo();
    await store.putConsent(SUB, consent());
    await store.reserveImport(SUB, { day: '2026-11-04', bytes: MiB, importId: 'imp-1' });
    expect(await store.markDeleting(SUB, START)).toEqual({ ok: false, reason: 'running' });
    expect((await store.getAccount(SUB))?.status).toBe('active');
    await store.releaseImport(SUB, 'imp-1', MiB);
    client.beforeUpdate = () => {
      client.items.get(`ACCT#${SUB}`)!.running_import_id = 'pending:1:other-tab';
    };
    expect(await store.markDeleting(SUB, START)).toEqual({ ok: false, reason: 'running' });
    expect((await store.getAccount(SUB))?.status).toBe('active');
  });

  it('T-WSCR-8: reserveImport is refused for an account being deleted, on a new day and the same day', async () => {
    const { client, store } = dynamo();
    await store.putConsent(SUB, consent());
    expect(await store.markDeleting(SUB, START)).toEqual({ ok: true });
    expect(await store.reserveImport(SUB, { day: '2026-11-04', bytes: 1, importId: 'imp-1' })).toEqual({ ok: false, reason: 'deleting' });
    // The condition alone decides: a mark that lands between the read and the update fails the reservation.
    const other = dynamo();
    await other.store.putConsent(SUB, consent());
    expect(await other.store.reserveImport(SUB, { day: '2026-11-04', bytes: 1, importId: 'imp-1' })).toEqual({ ok: true });
    await other.store.releaseImport(SUB, 'imp-1', 1);
    other.client.beforeUpdate = () => {
      other.client.items.get(`ACCT#${SUB}`)!.status = 'deleting';
    };
    expect(await other.store.reserveImport(SUB, { day: '2026-11-04', bytes: 1, importId: 'imp-2' })).toEqual({ ok: false, reason: 'deleting' });
    expect((await other.store.getAccount(SUB))?.runningImportId).toBeUndefined();
    expect(client.items.get(`ACCT#${SUB}`)?.running_import_id).toBeUndefined();
  });

  it('T-WSCR-8: confirmImport swaps only its own placeholder for the import id, keeping the reserved bytes', async () => {
    const { store } = dynamo();
    await store.putConsent(SUB, consent());
    await store.reserveImport(SUB, { day: '2026-11-04', bytes: 5 * MiB, importId: 'pending:1:a' });
    expect(await store.confirmImport(SUB, 'pending:1:b', 'imp-b')).toBe(false);
    expect((await store.getAccount(SUB))?.runningImportId).toBe('pending:1:a');
    expect(await store.confirmImport(SUB, 'pending:1:a', 'imp-a')).toBe(true);
    expect((await store.getAccount(SUB))?.runningImportId).toBe('imp-a');
    await store.releaseImport(SUB, 'imp-a', 2 * MiB);
    expect((await store.getAccount(SUB))?.runningImportId).toBeUndefined();
    expect((await store.getAccount(SUB))?.storedBytes).toBe(2 * MiB);
  });

  it('T-WSCR-8: the reserved size stays on the row with the reservation; releasing with it keeps it counted', async () => {
    const { client, store } = dynamo();
    await store.putConsent(SUB, consent());
    await store.reserveImport(SUB, { day: '2026-11-04', bytes: 1_200, importId: 'imp-1' });
    expect(client.items.get(`ACCT#${SUB}`)?.running_import_bytes).toBe(1_200);
    expect(await store.getAccount(SUB)).toMatchObject({ runningImportId: 'imp-1', runningImportBytes: 1_200, storedBytes: 1_200 });
    await store.releaseImport(SUB, 'imp-1', 1_200);
    const account = await store.getAccount(SUB);
    expect(account).toMatchObject({ storedBytes: 1_200, importsToday: { day: '2026-11-04', n: 1 } });
    expect(account?.runningImportBytes).toBeUndefined();
  });

  it("T-WSCR-8: a placeholder release gives back the day's count in the same conditional update, once, and only for its day", async () => {
    const { client, store } = dynamo();
    await store.putConsent(SUB, consent());
    await store.reserveImport(SUB, { day: '2026-11-04', bytes: MiB, importId: 'pending:1:a' });
    await store.releaseImport(SUB, 'pending:1:a', 0, { giveBackDay: '2026-11-04' });
    expect(await store.getAccount(SUB)).toMatchObject({ storedBytes: 0, importsToday: { day: '2026-11-04', n: 0 } });
    expect((await store.getAccount(SUB))?.runningImportId).toBeUndefined();
    const updates = client.sent.filter((c) => c.name === 'UpdateCommand');
    expect(updates.at(-1)?.input).toMatchObject({
      UpdateExpression: 'SET #b = :next, #t.#n = #t.#n - :one REMOVE #r, #rb',
      ConditionExpression: '#r = :id AND #b = :stored AND #t.#d = :day AND #t.#n > :zero',
    });
    // Once: the slot is no longer this placeholder's, so a second release changes nothing.
    await store.releaseImport(SUB, 'pending:1:a', 0, { giveBackDay: '2026-11-04' });
    expect((await store.getAccount(SUB))?.importsToday).toEqual({ day: '2026-11-04', n: 0 });
    // Another day's count is never taken back.
    await store.reserveImport(SUB, { day: '2026-11-05', bytes: MiB, importId: 'pending:2:b' });
    await store.releaseImport(SUB, 'pending:2:b', 0, { giveBackDay: '2026-11-04' });
    expect(await store.getAccount(SUB)).toMatchObject({ storedBytes: 0, importsToday: { day: '2026-11-05', n: 1 } });
    expect((await store.getAccount(SUB))?.runningImportId).toBeUndefined();
  });

  it('T-WAUTH-13: a service error is thrown, never read as a missing row or a refusal', async () => {
    const { client, store } = dynamo();
    client.failNext = 'ProvisionedThroughputExceededException';
    await expect(store.getAccount(SUB)).rejects.toThrow('fake service error');
    client.failNext = 'InternalServerError';
    await expect(store.reserveImport(SUB, { day: '2026-11-04', bytes: 1, importId: 'imp-1' })).rejects.toThrow('fake service error');
  });
});

afterEach(() => vi.unstubAllEnvs());
