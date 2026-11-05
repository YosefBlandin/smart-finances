// @vitest-environment jsdom
import { ROUTES } from '@smart-finances/contracts/routes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Container } from '@/adapters/container';

// T-WSCR-18 (AC-6, AC-15, D-127): every /api/data route refuses without a session and the current consent, and answers
// contract-shaped JSON for the signed-in person. STAGE=test: the shared memory container with TEST_PERSON and the
// fixtures (SF-161); a fresh container per test, so the person limit (5 a minute under STAGE=test) starts at zero.

const jar = vi.hoisted(() => ({ sid: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === '__Host-sid' && jar.sid ? { name, value: jar.sid } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { url });
  },
}));

const SHARED = Symbol.for('smart-finances.container');
let container: Container;
let TEST_PERSON: { sessionId: string; sub: string };

beforeEach(async () => {
  vi.stubEnv('STAGE', 'test');
  delete (globalThis as { [SHARED]?: unknown })[SHARED];
  const mod = await import('@/adapters/container');
  container = mod.getContainer();
  TEST_PERSON = mod.TEST_PERSON;
  jar.sid = TEST_PERSON.sessionId;
});

afterEach(() => {
  cleanup();
  delete (globalThis as { [SHARED]?: unknown })[SHARED];
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  jar.sid = undefined;
});

const transactions = () => import('./transactions/route');
const totals = () => import('./totals/route');
const rates = () => import('./rates/route');
const review = () => import('./review/route');
const imports = () => import('./imports/route');
const oneImport = () => import('./imports/[id]/route');
const exportCsv = () => import('./export/route');

const req = (path: string) => new Request(`http://localhost:3000${path}`);

/** Spies on every data API method (the DataApi port), so a test can show the data API was never asked. */
const DATA_API_METHODS = [
  'listTransactions',
  'totals',
  'rates',
  'putRate',
  'review',
  'putReview',
  'listImports',
  'getImport',
  'requestImport',
  'exportCsv',
  'erase',
] as const satisfies readonly (keyof Container['dataApi'])[];
function spyDataApi() {
  return DATA_API_METHODS.map((m) => vi.spyOn(container.dataApi, m));
}
const noneCalled = (spies: ReturnType<typeof spyDataApi>) =>
  expect(spies.filter((s) => s.mock.calls.length > 0).map((s) => s.getMockName())).toEqual([]);
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

/** Every data route, called once. */
const ALL: [string, () => Promise<Response>][] = [
  ['transactions', async () => (await transactions()).GET(req('/api/data/transactions?from=2026-03&to=2026-03'))],
  ['totals', async () => (await totals()).GET(req('/api/data/totals?from=2026-01&to=2026-03'))],
  ['rates', async () => (await rates()).GET()],
  ['review', async () => (await review()).GET()],
  ['imports', async () => (await imports()).GET(req('/api/data/imports'))],
  ['imports/[id]', async () => (await oneImport()).GET(req('/api/data/imports/01JA7R2M9X'), idParams('01JA7R2M9X'))],
  ['export', async () => (await exportCsv()).GET()],
];

describe('T-WSCR-18: /api/data refuses without a session and consent', () => {
  it.each(ALL)('T-WSCR-18: %s without a session cookie is 401, not cached, and never asks the data API', async (_name, call) => {
    jar.sid = undefined;
    const spies = spyDataApi();
    const res = await call();
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await res.json()).toEqual({ error: { code: 'unauthorized' } });
    noneCalled(spies);
  });

  it.each(ALL)('T-WSCR-18: %s with an unknown session is 401 and never asks the data API', async (_name, call) => {
    jar.sid = 'x'.repeat(43);
    const spies = spyDataApi();
    expect((await call()).status).toBe(401);
    noneCalled(spies);
  });

  it.each(ALL)('T-WSCR-18: %s without the current consent is 403 and never asks the data API', async (_name, call) => {
    await container.accountStore.putConsent(TEST_PERSON.sub, { termsVersion: '2000-01-01', privacyVersion: '2000-01-01', lang: 'en', acceptedAt: 1 });
    const spies = spyDataApi();
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: 'consent' } });
    noneCalled(spies);
  });

  it.each(ALL)('T-WSCR-18: %s for an account being deleted is 403 and never asks the data API', async (_name, call) => {
    await container.accountStore.markDeleting(TEST_PERSON.sub, container.clock.now());
    const spies = spyDataApi();
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: 'forbidden' } });
    noneCalled(spies);
  });

  it.each(ALL)("T-WSCR-18: %s carries none of the session's tokens in its body or headers", async (_name, call) => {
    const row = (await container.sessionStore.listBySub(TEST_PERSON.sub))[0]!;
    const secrets = [row.accessToken, row.idToken, row.refreshToken];
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.text();
    const headers = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');
    for (const secret of secrets) {
      expect(body).not.toContain(secret);
      expect(headers).not.toContain(secret);
    }
    expect(headers).not.toMatch(/bearer/i);
  });
});

describe('T-WSCR-18: /api/data answers contract-shaped JSON', () => {
  it('T-WSCR-18: transactions: the filters and the cursor reach the data API, the reply is the contract shape', async () => {
    const { GET } = await transactions();
    const first = await GET(req('/api/data/transactions?from=2026-03&to=2026-03&kind=expense&limit=20'));
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toContain('no-store');
    const page1 = ROUTES['GET /transactions'].reply.parse(await first.json());
    expect(page1.items).toHaveLength(20);
    expect(page1.items.every((t) => t.kind === 'expense' && t.date.startsWith('2026-03'))).toBe(true);
    expect(page1.cursor).toBeTruthy();
    const second = await GET(req(`/api/data/transactions?from=2026-03&to=2026-03&kind=expense&limit=20&cursor=${page1.cursor}`));
    const page2 = ROUTES['GET /transactions'].reply.parse(await second.json());
    expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id);
    // Sorted by date, newest first, by default.
    expect([...page1.items.map((t) => t.date)]).toEqual([...page1.items.map((t) => t.date)].sort().reverse());
  });

  it('T-WSCR-18: transactions: free text filters the rows; an input the contracts refuse is 400', async () => {
    const { GET } = await transactions();
    const found = ROUTES['GET /transactions'].reply.parse(await (await GET(req('/api/data/transactions?from=2025-11&to=2026-10&q=onerror'))).json());
    expect(found.items.map((t) => t.description_raw)).toContain('<img src=x onerror=alert(1)>');
    const bad = await GET(req('/api/data/transactions?from=2026-07&to=2026-05'));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: { code: 'bad_request' } });
  });

  it('T-WSCR-18: totals, rates, review and imports parse with their reply schemas', async () => {
    const t = await (await totals()).GET(req('/api/data/totals?from=2026-01&to=2026-03&view=native'));
    expect(ROUTES['GET /totals'].reply.parse(await t.json()).months.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    const r = await (await rates()).GET();
    expect(ROUTES['GET /rates'].reply.parse(await r.json()).items.length).toBeGreaterThan(0);
    const v = await (await review()).GET();
    expect(ROUTES['GET /review'].reply.parse(await v.json()).items.length).toBe(64 + 8);
    const i = await (await imports()).GET(req('/api/data/imports'));
    expect(ROUTES['GET /imports'].reply.parse(await i.json()).items.length).toBeGreaterThan(0);
  });

  it('T-WSCR-18: imports/[id] answers the record, or 404 for an unknown id', async () => {
    const { GET } = await oneImport();
    const found = await GET(req('/api/data/imports/01JA7R2M9X'), idParams('01JA7R2M9X'));
    expect(found.status).toBe(200);
    const record = ROUTES['GET /imports/{id}'].reply.parse(await found.json());
    expect(record).toMatchObject({ import_id: '01JA7R2M9X', status: 'done' });
    const missing = await GET(req('/api/data/imports/nope'), idParams('nope'));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: { code: 'not_found' } });
  });

  it('T-WSCR-18: export is the CSV as a download, never cached', async () => {
    const res = await (await exportCsv()).GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="[\w.-]+\.csv"$/);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const text = await res.text();
    expect(text.split('\n')[0]).toBe((ROUTES['GET /export'].columns as readonly string[]).join(','));
  });

  it('T-WSCR-18: past the person limit a route answers 429 with the wait (AC-17)', async () => {
    const { GET } = await rates();
    for (let i = 0; i < 5; i++) expect((await GET()).status).toBe(200);
    const res = await GET();
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await res.json()).toEqual({ error: { code: 'limited' } });
  });

  it('T-WSCR-18: a data API failure is a 502 the screen can retry; an API refusal of the token is 401', async () => {
    const { GET } = await rates();
    vi.spyOn(container.dataApi, 'rates').mockResolvedValueOnce({ ok: false, kind: 'failed', code: 'timeout' });
    const failed = await GET();
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: { code: 'timeout' } });
    vi.spyOn(container.dataApi, 'rates').mockResolvedValueOnce({ ok: false, kind: 'unauthorized' });
    expect((await GET()).status).toBe(401);
    vi.spyOn(container.dataApi, 'rates').mockRejectedValueOnce(new Error('boom'));
    const thrown = await GET();
    expect(thrown.status).toBe(503);
    expect(await thrown.json()).toEqual({ error: { code: 'unavailable' } });
  });

  it('T-WSCR-18: a 409 answers only a code the contracts list for 409; any other code becomes conflict', async () => {
    const { GET } = await rates();
    const conflict = (code?: string) => vi.spyOn(container.dataApi, 'rates').mockResolvedValueOnce({ ok: false, kind: 'conflict', code });
    conflict('source_file_only');
    const known = await GET();
    expect(known.status).toBe(409);
    expect(await known.json()).toEqual({ error: { code: 'source_file_only' } });
    for (const code of ['<img src=x onerror=alert(1)>', 'not_found', 'too_large', undefined]) {
      conflict(code);
      const res = await GET();
      expect(res.status).toBe(409);
      expect(await res.json(), String(code)).toEqual({ error: { code: 'conflict' } });
    }
  });

  it("T-WSCR-18: the person is the session's: no route reads a person from the address", async () => {
    const seen: string[] = [];
    const spy = vi.spyOn(container.dataApi, 'review');
    spy.mockImplementation(async (token) => {
      seen.push(token);
      return { ok: true, data: { items: [] } };
    });
    await (await review()).GET();
    const row = (await container.sessionStore.listBySub(TEST_PERSON.sub))[0];
    expect(seen).toEqual([row!.accessToken]);
  });
});

describe('T-WSCR-18: server renders go to the limit page', () => {
  it('T-WSCR-18: redirectIfLimited sends a limited read to /too-many with the wait, and passes the rest through', async () => {
    const { redirectIfLimited } = await import('./respond');
    expect(() => redirectIfLimited({ ok: false, kind: 'limited', retryAfter: 42 })).toThrow('NEXT_REDIRECT /too-many?wait=42');
    const failed = { ok: false as const, kind: 'failed' as const };
    expect(redirectIfLimited(failed)).toBe(failed);
    const ok = { ok: true as const, data: 1 };
    expect(redirectIfLimited(ok)).toBe(ok);
  });
});

// The hooks (D-127, D-130) against the real route handlers: fetch is stubbed to call them in process.
describe('T-WSCR-18: the data hooks use the routes', () => {
  const ROUTE_OF: [RegExp, (path: string) => Promise<Response>][] = [
    [/^\/api\/data\/transactions/, async (p) => (await transactions()).GET(req(p))],
    [/^\/api\/data\/totals/, async (p) => (await totals()).GET(req(p))],
    [/^\/api\/data\/rates$/, async () => (await rates()).GET()],
    [/^\/api\/data\/review$/, async () => (await review()).GET()],
    [/^\/api\/data\/imports$/, async () => (await imports()).GET(req('/api/data/imports'))],
    [/^\/api\/data\/imports\/([^/?]+)$/, async (p) => (await oneImport()).GET(req(p), idParams(decodeURIComponent(p.split('/').pop()!)))],
  ];
  function stubFetch() {
    const paths: string[] = [];
    vi.stubGlobal('fetch', async (path: string) => {
      paths.push(path);
      const hit = ROUTE_OF.find(([re]) => re.test(path));
      if (!hit) return new Response('{}', { status: 404 });
      return hit[1](path);
    });
    return paths;
  }
  function wrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return function Wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client }, children);
    };
  }

  it('T-WSCR-18: useTransactions pages by cursor; the key holds the month and the filters', async () => {
    const paths = stubFetch();
    const { useTransactions } = await import('@/queries/data');
    const { dataKeys } = await import('@/queries/keys');
    const filters = { month: '2026-03', kind: 'expense', limit: 20 };
    expect(dataKeys.transactions(filters)).toEqual([
      'data',
      'transactions',
      { month: '2026-03', kind: 'expense', limit: 20, sort: 'date', order: 'desc' },
    ]);
    const { result } = renderHook(() => useTransactions(filters), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0]?.items).toHaveLength(20);
    expect(result.current.hasNextPage).toBe(true);
    await result.current.fetchNextPage();
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(paths[0]).toBe('/api/data/transactions?from=2026-03&to=2026-03&kind=expense&sort=date&order=desc&limit=20');
    expect(paths[1]).toMatch(/&cursor=20$/);
  });

  it('T-WSCR-18: the totals key changes with the months and the view; the import key with the id', async () => {
    const { dataKeys } = await import('@/queries/keys');
    const base = { from: '2026-01', to: '2026-03', view: 'native' } as const;
    expect(dataKeys.totals(base)).toEqual(dataKeys.totals({ ...base }));
    for (const other of [
      { ...base, view: 'usd' as const },
      { ...base, from: '2025-12' },
      { ...base, to: '2026-04' },
    ]) {
      expect(dataKeys.totals(other), JSON.stringify(other)).not.toEqual(dataKeys.totals(base));
    }
    expect(dataKeys.import('01JA7R2M9X')).toEqual(['data', 'imports', '01JA7R2M9X']);
    expect(dataKeys.import('01JA7R2M9X')).not.toEqual(dataKeys.import('01JA7R2M9Y'));
    expect(dataKeys.import('01JA7R2M9X')).not.toEqual(dataKeys.imports());
  });

  it('T-WSCR-18: useTotals, useRates, useReview and useImports read their routes', async () => {
    const paths = stubFetch();
    const q = await import('@/queries/data');
    const { result } = renderHook(
      () => [q.useTotals({ from: '2026-01', to: '2026-03', view: 'native' }), q.useRates(), q.useReview(), q.useImports()] as const,
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.every((r) => r.isSuccess)).toBe(true));
    expect(result.current[0].data?.months).toHaveLength(3);
    expect(paths.sort()).toEqual([
      '/api/data/imports',
      '/api/data/rates',
      '/api/data/review',
      '/api/data/totals?from=2026-01&to=2026-03&view=native',
    ]);
  });

  it('T-WSCR-18: a refused answer is a DataError with its status and code; only failures worth repeating are retried', async () => {
    stubFetch();
    jar.sid = undefined;
    const { useRates, DataError, retryable } = await import('@/queries/data');
    const { result } = renderHook(() => useRates(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(DataError);
    expect(result.current.error).toMatchObject({ status: 401, code: 'unauthorized' });
    expect(retryable(0, new DataError(401, 'unauthorized'))).toBe(false);
    expect(retryable(0, new DataError(429, 'limited', 30))).toBe(false);
    expect(retryable(0, new DataError(502, 'timeout'))).toBe(true);
    expect(retryable(2, new DataError(502, 'timeout'))).toBe(false);
  });

  it("T-WSCR-18: a throttled reply is retried after the server's Retry-After, capped; past the cap it is not retried", async () => {
    const { DataError, retryable, retryDelay, MAX_RETRY_WAIT_S } = await import('@/queries/data');
    expect(MAX_RETRY_WAIT_S).toBe(30);
    expect(retryDelay(0, new DataError(502, 'throttled', 7))).toBe(7_000);
    expect(retryDelay(1, new DataError(429, 'limited', 30))).toBe(30_000);
    expect(retryable(0, new DataError(502, 'throttled', 7))).toBe(true);
    expect(retryable(0, new DataError(502, 'throttled', 31))).toBe(false);
    expect(retryDelay(5, new DataError(502, 'throttled', 3_600))).toBe(30_000);
    // Without a wait from the server: 1 s, 2 s, doubling to 30 s.
    expect([0, 1, 2, 10].map((n) => retryDelay(n, new DataError(502, 'server')))).toEqual([1_000, 2_000, 4_000, 30_000]);
    expect(retryDelay(0, new Error('x'))).toBe(1_000);
  });

  it('T-WSCR-18: useImport polls until the import is final', async () => {
    const paths = stubFetch();
    const record = { import_id: 'imp-x', source: 'csv', file_name: 'a.csv', period: '2026-05', status: 'importing', created_at: 'x', active: false };
    const statuses = ['requested', 'importing', 'done'];
    let n = 0;
    vi.spyOn(container.dataApi, 'getImport').mockImplementation(async () => ({ ok: true, data: { ...record, status: statuses[Math.min(n++, 2)]! } }));
    const { useImport } = await import('@/queries/data');
    const { result } = renderHook(() => useImport('imp-x', { intervalMs: 20 }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.status).toBe('done'), { timeout: 2000 });
    const calls = paths.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(paths.length).toBe(calls);
    expect(calls).toBe(3);
    expect(paths[0]).toBe('/api/data/imports/imp-x');
  });

  const importRecord = (status: string) => ({
    ok: true as const,
    data: { import_id: 'imp-x', source: 'csv', file_name: 'a.csv', period: '2026-05', status, created_at: 'x', active: false },
  });

  it('T-WSCR-18: useImport stops polling at stalled (it waits for a repair, not for time)', async () => {
    const paths = stubFetch();
    const statuses = ['importing', 'stalled'];
    let n = 0;
    vi.spyOn(container.dataApi, 'getImport').mockImplementation(async () => importRecord(statuses[Math.min(n++, 1)]!));
    const { useImport } = await import('@/queries/data');
    const { result } = renderHook(() => useImport('imp-x', { intervalMs: 20 }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.status).toBe('stalled'), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 150));
    expect(paths).toHaveLength(2);
  });

  it('T-WSCR-18: useImport stops polling on a refusal (an unknown id is 404)', async () => {
    const paths = stubFetch();
    const { useImport, DataError } = await import('@/queries/data');
    const { result } = renderHook(() => useImport('nope', { intervalMs: 20 }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 2000 });
    expect(result.current.error).toBeInstanceOf(DataError);
    expect(result.current.error).toMatchObject({ status: 404, code: 'not_found' });
    await new Promise((r) => setTimeout(r, 150));
    expect(paths).toEqual(['/api/data/imports/nope']);
  });

  it('T-WSCR-18: useImport backs off (doubling to a ceiling) and stops after maxPolls reads of an import that never settles', async () => {
    const paths: string[] = [];
    const at: number[] = [];
    vi.stubGlobal('fetch', async (path: string) => {
      paths.push(path);
      at.push(performance.now());
      return Response.json(importRecord('requested').data);
    });
    const { useImport } = await import('@/queries/data');
    const { result } = renderHook(() => useImport('imp-x', { intervalMs: 20, maxIntervalMs: 80, maxPolls: 5 }), { wrapper: wrapper() });
    await waitFor(() => expect(paths).toHaveLength(5), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(paths).toHaveLength(5);
    expect(result.current.data?.status).toBe('requested');
    // The waits between reads: 20, 40, 80, 80 ms (a timer never fires early; allow 2 ms of clock rounding).
    const gaps = at.slice(1).map((t, i) => t - at[i]!);
    [20, 40, 80, 80].forEach((min, i) => expect(gaps[i], `gap ${i}`).toBeGreaterThanOrEqual(min - 2));
  });

  it('T-WSCR-18: importPollDelay: 3 s doubling to 30 s, and no more polls after 23 reads (under 10 minutes)', async () => {
    const { importPollDelay, IMPORT_POLL } = await import('@/queries/data');
    expect(IMPORT_POLL).toEqual({ intervalMs: 3_000, maxIntervalMs: 30_000, maxPolls: 23 });
    expect([1, 2, 3, 4, 5, 6, 22].map((reads) => importPollDelay(reads))).toEqual([3_000, 6_000, 12_000, 24_000, 30_000, 30_000, 30_000]);
    expect(importPollDelay(23)).toBe(false);
    const total = Array.from({ length: 22 }, (_, i) => importPollDelay(i + 1) as number).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(10 * 60_000);
  });
});
