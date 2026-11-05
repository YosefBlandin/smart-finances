/* eslint-disable import/no-restricted-paths -- T-WAUTH-6 is the task's one test file and covers the proof of work end
   to end: the use case, the DynamoDB claim adapter, the /api/auth/pow route and the browser's solver in PowField. No
   production application code imports these. */
import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPow, POW_MAX, POW_TTL_MS, type PowChallenge } from '@/application/pow';
import { DynamoPowStore } from '@/adapters/dynamodb/pow';
import type { DocClient } from '@/adapters/dynamodb/sessions';
import { MemoryClock } from '@/adapters/memory/clock';
import { MemoryPowStore } from '@/adapters/memory/pow-store';
import { MemorySecretStore } from '@/adapters/memory/secret-store';
import { MemorySettings, TEST_SETTINGS } from '@/adapters/memory/settings';
import { GET } from '@/app/api/auth/pow/route';
import type { PowStore } from '@/ports/pow-store';
import { solvePow } from '@/ui/PowField';

// T-WAUTH-6 (AC-19, D-120): a proof-of-work answer is accepted once, refused when reused, wrong or older than 10
// minutes. Synthetic values only: the memory secret store's test secret, a fake table. No AWS call: the DynamoDB
// adapter gets a hand-written fake document client.
const MIN = 60_000;
const T0 = 1_790_000_000_000;
const TABLE = 'sessions-test';
const SMALL_MAX = 2_000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function setup(opts: { max?: number; secret?: string; store?: PowStore } = {}) {
  const clock = new MemoryClock(T0);
  const secretStore = new MemorySecretStore();
  if (opts.secret) secretStore.set(TEST_SETTINGS.HMAC_SECRET_ARN, opts.secret);
  const powStore = opts.store ?? new MemoryPowStore(clock);
  const pow = createPow({ powStore, clock, secretStore, settings: new MemorySettings(), max: opts.max ?? SMALL_MAX });
  return { clock, pow, powStore };
}

async function answer(c: PowChallenge) {
  const n = await solvePow(c);
  if (n === undefined) throw new Error('no solution found');
  return { salt: c.salt, n: String(n), sig: c.sig };
}

describe('T-WAUTH-6 proof of work (application/pow.ts)', () => {
  it('T-WAUTH-6 issues { salt, challenge = SHA-256(salt + n), max, expires, sig } with a 10-minute life', async () => {
    const { pow } = setup({ max: undefined });
    const big = createPow({
      powStore: new MemoryPowStore(new MemoryClock(T0)),
      clock: new MemoryClock(T0),
      secretStore: new MemorySecretStore(),
      settings: new MemorySettings(),
    });
    const c = await big.issue();
    expect(Object.keys(c).sort()).toEqual(['challenge', 'expires', 'max', 'salt', 'sig']);
    expect(c.max).toBe(100_000);
    expect(POW_MAX).toBe(100_000);
    expect(POW_TTL_MS).toBe(10 * MIN);
    expect(c.expires).toBe(T0 + 10 * MIN);
    expect(c.challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(c.sig).toMatch(/^[0-9a-f]{64}$/);

    const small = await pow.issue();
    const n = await solvePow(small);
    expect(n).toBeDefined();
    expect(n!).toBeGreaterThanOrEqual(0);
    expect(n!).toBeLessThanOrEqual(SMALL_MAX);
    expect(sha256(small.salt + String(n))).toBe(small.challenge);
    // A fresh salt each time.
    expect((await pow.issue()).salt).not.toBe(small.salt);
  });

  it('T-WAUTH-6 the signature is an HMAC-SHA256 under the stage HMAC secret; another secret is refused', async () => {
    const { pow } = setup();
    const c = await pow.issue();
    const expected = createHmac('sha256', 'test-hmac-secret').update(`pow:${c.challenge}`).digest('hex');
    expect(c.sig).toBe(expected);

    const other = setup({ secret: 'another-test-secret' });
    expect(await other.pow.verify(await answer(c))).toEqual({ ok: false, reason: 'wrong' });
  });

  it('T-WAUTH-6 accepts a correct answer once and refuses it when reused', async () => {
    const { pow } = setup();
    const a = await answer(await pow.issue());
    expect(await pow.verify(a)).toEqual({ ok: true });
    expect(await pow.verify(a)).toEqual({ ok: false, reason: 'reused' });
    // A second challenge is its own answer.
    expect(await pow.verify(await answer(await pow.issue()))).toEqual({ ok: true });
  });

  it('T-WAUTH-6 refuses a wrong answer: another n, a changed salt, expiry or signature, and claims nothing', async () => {
    const claims: string[] = [];
    const store: PowStore = { claim: async (h) => (claims.push(h), true) };
    const { pow } = setup({ store });
    const c = await pow.issue();
    const a = await answer(c);
    const [rand, expires] = c.salt.split('.');
    const wrongs = [
      { ...a, n: String((Number(a.n) + 1) % (SMALL_MAX + 1)) },
      { ...a, salt: `${rand}.${Number(expires) + 60 * MIN}` },
      { ...a, salt: `${rand!.slice(0, -1)}${rand!.endsWith('A') ? 'B' : 'A'}.${expires}` },
      { ...a, sig: a.sig.replace(/^./, (ch) => (ch === '0' ? '1' : '0')) },
    ];
    for (const w of wrongs) expect(await pow.verify(w)).toEqual({ ok: false, reason: 'wrong' });
    expect(claims).toEqual([]);
  });

  it('T-WAUTH-6 refuses an answer older than 10 minutes, and accepts it just before', async () => {
    const { pow, clock } = setup();
    const late = await answer(await pow.issue());
    const onTime = await answer(await pow.issue());
    clock.advance(10 * MIN - 1);
    expect(await pow.verify(onTime)).toEqual({ ok: true });
    clock.advance(1);
    expect(await pow.verify(late)).toEqual({ ok: false, reason: 'expired' });
  });

  it('T-WAUTH-6 refuses a missing or malformed answer without throwing', async () => {
    const { pow } = setup();
    const a = await answer(await pow.issue());
    expect(await pow.verify({ salt: undefined, n: undefined, sig: undefined })).toEqual({ ok: false, reason: 'missing' });
    expect(await pow.verify({ salt: '', n: '', sig: '' })).toEqual({ ok: false, reason: 'missing' });
    const bad = [
      { ...a, n: '-1' },
      { ...a, n: '1.5' },
      { ...a, n: '1e3' },
      { ...a, n: String(SMALL_MAX + 1) },
      { ...a, n: ' 1' },
      { ...a, salt: 'no-expiry' },
      { ...a, salt: `${a.salt}x` },
      { ...a, sig: 'zz' },
      { ...a, sig: a.sig.toUpperCase() + '0' },
      { ...a, n: 12 },
      { ...a, salt: ['x'] },
    ];
    for (const b of bad) expect(await pow.verify(b)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('T-WAUTH-6 claims one use under the SHA-256 of the salt for 10 minutes', async () => {
    const calls: [string, number][] = [];
    const store: PowStore = { claim: async (h, ttl) => (calls.push([h, ttl]), true) };
    const { pow } = setup({ store });
    const c = await pow.issue();
    expect(await pow.verify(await answer(c))).toEqual({ ok: true });
    expect(calls).toEqual([[sha256(c.salt), 10 * MIN]]);
  });

  it('T-WAUTH-6 a claim store failure is thrown, never read as accepted', async () => {
    const store: PowStore = {
      claim: async () => {
        throw new Error('fake service error');
      },
    };
    const { pow } = setup({ store });
    await expect(pow.verify(await answer(await pow.issue()))).rejects.toThrow('fake service error');
  });
});

describe('T-WAUTH-6 solvePow (ui/PowField.tsx, Web Crypto)', () => {
  it('T-WAUTH-6 finds n with Web Crypto, and gives up past max', async () => {
    const salt = 'synthetic-salt.1790000600000';
    expect(await solvePow({ salt, challenge: sha256(`${salt}37`), max: 100 })).toBe(37);
    expect(await solvePow({ salt, challenge: sha256(`${salt}0`), max: 100 })).toBe(0);
    expect(await solvePow({ salt, challenge: sha256(`${salt}101`), max: 100 })).toBeUndefined();
  });
});

// A fake document client for the pow item: honours the one condition the adapter writes and throws on anything else.
class FakeTable implements DocClient {
  readonly items = new Map<string, Record<string, unknown>>();
  readonly sent: { name: string; input: Record<string, unknown> }[] = [];
  failNext?: string;

  async send(command: { input: object }) {
    const name = command.constructor.name;
    const input = structuredClone(command.input) as Record<string, unknown>;
    this.sent.push({ name, input });
    if (this.failNext) {
      const e = new Error('fake service error');
      e.name = this.failNext;
      this.failNext = undefined;
      throw e;
    }
    expect(name).toBe('PutCommand');
    expect(input.TableName).toBe(TABLE);
    expect(input.ConditionExpression).toBe('attribute_not_exists(pk) OR expires_at <= :now');
    const item = input.Item as { pk: string; expires_at: number };
    const now = (input.ExpressionAttributeValues as { ':now': number })[':now'];
    const old = this.items.get(item.pk);
    if (old && !((old.expires_at as number) <= now)) {
      const e = new Error('The conditional request failed');
      e.name = 'ConditionalCheckFailedException';
      throw e;
    }
    this.items.set(item.pk, item);
    return {};
  }
}

describe('T-WAUTH-6 DynamoPowStore (adapters/dynamodb/pow.ts)', () => {
  const hash = sha256('synthetic-salt');

  it('T-WAUTH-6 claims POW#<sha256 of salt> once, with expires_at in epoch seconds', async () => {
    const clock = new MemoryClock(T0);
    const table = new FakeTable();
    const store = new DynamoPowStore({ client: table, tableName: TABLE, clock });
    expect(await store.claim(hash, 10 * MIN)).toBe(true);
    expect(table.items.get(`POW#${hash}`)).toEqual({ pk: `POW#${hash}`, expires_at: (T0 + 10 * MIN) / 1000 });
    clock.advance(5 * MIN);
    expect(await store.claim(hash, 10 * MIN)).toBe(false);
    expect(await store.claim(sha256('other-synthetic-salt'), 10 * MIN)).toBe(true);
  });

  it('T-WAUTH-6 a row past its expires_at no longer blocks (the TTL may lag), and nothing else is read as a claim', async () => {
    const clock = new MemoryClock(T0);
    const table = new FakeTable();
    const store = new DynamoPowStore({ client: table, tableName: TABLE, clock });
    expect(await store.claim(hash, 10 * MIN)).toBe(true);
    clock.advance(10 * MIN - 1);
    expect(await store.claim(hash, 10 * MIN)).toBe(false);
    clock.advance(1);
    expect(await store.claim(hash, 10 * MIN)).toBe(true);
    table.failNext = 'ProvisionedThroughputExceededException';
    await expect(store.claim(sha256('third-synthetic-salt'), 10 * MIN)).rejects.toThrow('fake service error');
  });
});

describe('T-WAUTH-6 GET /api/auth/pow', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('T-WAUTH-6 serves a fresh challenge, never cached, that the use case accepts once', async () => {
    vi.stubEnv('STAGE', 'test');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const c = (await res.json()) as PowChallenge;
    expect(c.max).toBe(100_000);
    expect(Math.abs(c.expires - (Date.now() + 10 * MIN))).toBeLessThan(5_000);

    const clock = new MemoryClock(Date.now());
    const pow = createPow({ powStore: new MemoryPowStore(clock), clock, secretStore: new MemorySecretStore(), settings: new MemorySettings() });
    const a = await answer(c);
    expect(await pow.verify(a)).toEqual({ ok: true });
    expect(await pow.verify(a)).toEqual({ ok: false, reason: 'reused' });
  }, 30_000); // A real proof-of-work solve; under a full parallel run it can pass 5 s (conformance fix).

  it('T-WAUTH-6 says plainly when the challenge cannot be issued, without a stack', async () => {
    vi.stubEnv('STAGE', 'qa');
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ error: { code: 'unavailable', message: 'Reload and try again.' } });
  });
});
