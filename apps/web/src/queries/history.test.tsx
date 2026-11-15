// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { historyRanges, HISTORY_LIMIT, HISTORY_MAX_PAGES, useHistory } from './data';
import { dataKeys, type Transaction } from './keys';

// T-HIST-1 to T-HIST-4 (category-suggestions D-24, D-26, AC-9, AC-14, RK-3): the review page's history read. Four
// 3-month reads of the transactions route with limit 200, at most 3 pages each; one failed range keeps the others;
// settle's invalidations leave it alone; leaving the page removes it; no payments row on the list means no read.
// Made-up rows only.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TODAY = new Date('2026-11-15T12:00:00');

const tx = (id: string, over: Partial<Transaction> = {}): Transaction => ({
  id,
  date: '2026-10-02',
  date_precision: 'day',
  kind: 'expense',
  amount: -1000,
  currency: 'ARS',
  category: 'Groceries',
  merchant: `Tienda Ficticia ${id}`,
  recipient_key: '',
  description_raw: `SYNTHETIC ${id}`,
  source: 'mercadopago',
  source_ref: id,
  country: 'AR',
  flags: [],
  import_batch: 'b',
  review: { reasons: [], approved: true },
  ...over,
});

type Reply = { status: number; body: unknown };
/** A fetch stub answering each /api/data/transactions request from `answer(range, cursor)`; it records every URL. */
function stubFetch(answer: (from: string, cursor: string | null) => Reply) {
  const urls: string[] = [];
  const fetchMock = vi.fn(async (input: string) => {
    urls.push(input);
    const url = new URL(input, 'http://localhost');
    const { status, body } = answer(url.searchParams.get('from') ?? '', url.searchParams.get('cursor'));
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return urls;
}

const PAYMENTS = [{ source: 'mercadopago' }];

function Probe({ rows }: { rows: { source: string }[] | undefined }) {
  const history = useHistory(rows, TODAY);
  return (
    <p>{history.data ? `examples ${history.data.examples.length} complete ${history.data.complete}` : history.isFetching ? 'reading' : 'idle'}</p>
  );
}

const client = () => new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
const wrap = (c: QueryClient, node: ReactNode) => <QueryClientProvider client={c}>{node}</QueryClientProvider>;

describe('T-HIST-1: four ranges, at most 12 requests', () => {
  it('T-HIST-1 the ranges are the current month and the 2 before it, then three earlier 3-month blocks', () => {
    expect(historyRanges(TODAY)).toEqual([
      { from: '2026-09', to: '2026-11' },
      { from: '2026-06', to: '2026-08' },
      { from: '2026-03', to: '2026-05' },
      { from: '2025-12', to: '2026-02' },
    ]);
    expect(historyRanges(new Date('2026-01-10T12:00:00'))[0]).toEqual({ from: '2025-11', to: '2026-01' });
  });

  it('T-HIST-1 each range reads with limit 200 and follows its cursor for at most 3 pages', async () => {
    expect(HISTORY_LIMIT).toBe(200);
    expect(HISTORY_MAX_PAGES).toBe(3);
    // Every range always has a next page: the cap stops it.
    const urls = stubFetch((from, cursor) => ({
      status: 200,
      body: { items: [tx(`${from}-${cursor ?? '0'}`)], cursor: `${Number(cursor ?? 0) + 1}` },
    }));
    render(wrap(client(), <Probe rows={PAYMENTS} />));
    expect(await screen.findByText('examples 12 complete true')).toBeTruthy();
    expect(urls).toHaveLength(12);
    for (const u of urls) {
      const url = new URL(u, 'http://localhost');
      expect(url.pathname).toBe('/api/data/transactions');
      expect(url.searchParams.get('limit')).toBe('200');
    }
    expect(new Set(urls.map((u) => new URL(u, 'http://localhost').searchParams.get('from')))).toEqual(
      new Set(['2026-09', '2026-06', '2026-03', '2025-12']),
    );
  });

  it('T-HIST-1 a range with no next page stops after one read, and the reply is examples, not raw rows', async () => {
    const urls = stubFetch((from) => ({ status: 200, body: { items: from === '2026-09' ? [tx('a'), tx('b', { category: 'Uncategorized' })] : [] } }));
    const c = client();
    render(wrap(c, <Probe rows={PAYMENTS} />));
    expect(await screen.findByText('examples 1 complete true')).toBeTruthy();
    expect(urls).toHaveLength(4);
    const data = c.getQueryData<{ examples: unknown[]; complete: boolean }>(dataKeys.history());
    expect(Object.keys(data ?? {}).sort()).toEqual(['complete', 'examples']);
    expect(data?.examples[0]).toEqual({
      key: '',
      name: 'tienda ficticia a',
      category: 'Groceries',
      owner: true,
      kind: 'expense',
      date: '2026-10-02',
    });
  });
});

describe('T-HIST-2: a failed range', () => {
  it('T-HIST-2 one range failing after its retry gives complete false and keeps the other ranges’ examples', async () => {
    const urls = stubFetch((from) =>
      from === '2026-06' ? { status: 503, body: { error: { code: 'unavailable' } } } : { status: 200, body: { items: [tx(from)] } },
    );
    render(wrap(client(), <Probe rows={PAYMENTS} />));
    expect(await screen.findByText('examples 3 complete false')).toBeTruthy();
    // The failing range was tried twice (one retry); the others once.
    expect(urls.filter((u) => u.includes('from=2026-06'))).toHaveLength(2);
    expect(urls).toHaveLength(5);
  });
});

describe('T-HIST-3: one read per visit', () => {
  it('T-HIST-3 settle’s invalidations do not refetch history; unmounting removes the query; a second mount reads again', async () => {
    const urls = stubFetch(() => ({ status: 200, body: { items: [tx('a')] } }));
    const c = client();
    const first = render(wrap(c, <Probe rows={PAYMENTS} />));
    expect(await screen.findByText('examples 4 complete true')).toBeTruthy();
    expect(urls).toHaveLength(4);
    // The review island's settle (Review.tsx) invalidates these three keys.
    await act(async () => {
      await c.invalidateQueries({ queryKey: dataKeys.review() });
      await c.invalidateQueries({ queryKey: [...dataKeys.all, 'totals'] });
      await c.invalidateQueries({ queryKey: [...dataKeys.all, 'transactions'] });
    });
    expect(urls).toHaveLength(4);
    expect(dataKeys.history()).toEqual(['data', 'history']);
    first.unmount();
    expect(c.getQueryCache().find({ queryKey: dataKeys.history() })).toBeUndefined();
    render(wrap(c, <Probe rows={PAYMENTS} />));
    expect(await screen.findByText('examples 4 complete true')).toBeTruthy();
    expect(urls).toHaveLength(8);
  });
});

describe('T-HIST-4: no payments rows, no read', () => {
  it('T-HIST-4 an empty or failed review list, or one with no payments row, starts no history read', async () => {
    const urls = stubFetch(() => ({ status: 200, body: { items: [] } }));
    const c = client();
    const { rerender } = render(wrap(c, <Probe rows={undefined} />));
    rerender(wrap(c, <Probe rows={[]} />));
    rerender(wrap(c, <Probe rows={[{ source: 'notion' }, { source: 'csv' }]} />));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByText('idle')).toBeTruthy();
    expect(urls).toHaveLength(0);
    rerender(wrap(c, <Probe rows={PAYMENTS} />));
    await waitFor(() => expect(urls).toHaveLength(4));
  });
});
