// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en.json';
import type { Example } from '@/domain/suggest';
import { dataKeys } from '@/queries/keys';
import { Review, SETTLE_AFTER_MS, type ChooseResult } from '../Review';
import type { ReviewRow } from '../View';

// T-SET-1, T-SET-2 (category-suggestions D-27, RK-9): after single choices the list is asked again once, 2 s after the
// last one settles, so a fast pass over the list stays inside the person's 120 data requests a minute. ChooseResult
// carries the action's retry wait. Made-up rows only.

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

beforeEach(() => {
  vi.useFakeTimers();
  nav.refresh.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const row = (id: string): ReviewRow => ({
  id,
  date: '2026-10-02',
  date_precision: 'day',
  kind: 'expense',
  amount: -1000,
  currency: 'ARS',
  category: 'Uncategorized',
  merchant: '',
  recipient_key: id.padStart(32, '0'),
  description_raw: `SYNTHETIC ${id}`,
  source: 'mercadopago',
  source_ref: id,
  country: 'AR',
  flags: ['needs_review'],
  import_batch: 'b',
  reasons: ['needs_review'],
});

/** Renders the island over n rows, each with a history pick; counts every data request by path. */
function setup(n: number, choose: () => Promise<ChooseResult> = async () => ({ ok: true })) {
  const rows = Array.from({ length: n }, (_, i) => row(`${i + 1}`));
  const examples: Example[] = rows.map((r) => ({
    key: r.recipient_key,
    name: '',
    category: 'Groceries',
    owner: true,
    kind: 'expense',
    date: '2026-06-01',
  }));
  const requests: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      requests.push(new URL(path, 'http://localhost').pathname);
      // The list as the server would answer now: unchanged rows are fine for counting.
      return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  // As the app's provider: hydrated data is fresh, so only settle asks again.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(dataKeys.review(), { items: rows });
  client.setQueryData(dataKeys.history(), { examples, complete: true });
  const spy = vi.fn(choose);
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <Review choose={spy} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { choose: spy, requests };
}

const accept = async (id: string) => {
  const r = screen.getAllByRole('row').find((el) => within(el).queryByText(`SYNTHETIC ${id}`))!;
  await act(async () => {
    fireEvent.click(within(r).getByRole('button', { name: 'Accept Groceries' }));
    await vi.advanceTimersByTimeAsync(0);
  });
};

describe('T-SET-1: one settle after a run of choices', () => {
  it('T-SET-1 ten quick single choices give one review refetch and one refresh, 2 s after the last settles', async () => {
    expect(SETTLE_AFTER_MS).toBe(2_000);
    const { choose, requests } = setup(10);
    for (let i = 1; i <= 10; i += 1) {
      await accept(`${i}`);
      await act(() => vi.advanceTimersByTimeAsync(300));
    }
    expect(choose).toHaveBeenCalledTimes(10);
    await act(() => vi.advanceTimersByTimeAsync(SETTLE_AFTER_MS - 400));
    expect(requests.filter((p) => p === '/api/data/review')).toHaveLength(0);
    expect(nav.refresh).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(requests.filter((p) => p === '/api/data/review')).toHaveLength(1);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it('T-SET-1 a new choice restarts the wait, and a choice still in flight holds it', async () => {
    let answer: (r: ChooseResult) => void = () => {};
    let slow = false;
    const { requests } = setup(3, () => (slow ? new Promise<ChooseResult>((resolve) => (answer = resolve)) : Promise.resolve({ ok: true })));
    await accept('1');
    await act(() => vi.advanceTimersByTimeAsync(1_500));
    slow = true;
    await accept('2');
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(nav.refresh).not.toHaveBeenCalled();
    await act(async () => {
      answer({ ok: true });
      await vi.advanceTimersByTimeAsync(SETTLE_AFTER_MS);
    });
    expect(requests.filter((p) => p === '/api/data/review')).toHaveLength(1);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('T-SET-2: the request limit', () => {
  it('T-SET-2 60 single accepts plus 12 history reads in one minute count at most 120 requests', async () => {
    const { choose, requests } = setup(60);
    for (let i = 1; i <= 60; i += 1) {
      await accept(`${i}`);
      // A fast pass: just under a second a row.
      await act(() => vi.advanceTimersByTimeAsync(950));
    }
    await act(() => vi.advanceTimersByTimeAsync(SETTLE_AFTER_MS));
    // Counted: each choose, each data refetch, 2 per server refresh (the page and the shell's count), the 12 history reads.
    const counted = choose.mock.calls.length + requests.length + 2 * nav.refresh.mock.calls.length + 12;
    expect(choose).toHaveBeenCalledTimes(60);
    expect(counted).toBeLessThanOrEqual(120);
  });
});

describe('T-SET-1: labels', () => {
  it('T-SET-1 a label followed by a choice settles once, 2 s after the last, and keeps the 5 s totals refetch', async () => {
    const rows = [{ ...row('1'), merchant: 'Made-up 1', category: 'Groceries' }, row('2')];
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        requests.push(new URL(path, 'http://localhost').pathname);
        return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(dataKeys.review(), { items: rows });
    client.setQueryData(dataKeys.history(), { examples: [], complete: true });
    const label = vi.fn(async (): Promise<ChooseResult> => ({ ok: true }));
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          <Review choose={async () => ({ ok: true })} label={label} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getAllByRole('button', { name: en.label.open })[0]!);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.label.save }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(label).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.review.approve }));
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(() => vi.advanceTimersByTimeAsync(SETTLE_AFTER_MS - 1));
    expect(nav.refresh).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    expect(requests.filter((p) => p === '/api/data/review')).toHaveLength(1);
    // The label's own totals refetch, 5 s after it saved.
    const totalsCalls = () =>
      invalidate.mock.calls.filter(([f]) => JSON.stringify(f?.queryKey) === JSON.stringify([...dataKeys.all, 'totals'])).length;
    const before = totalsCalls();
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(totalsCalls()).toBe(before + 1);
  });
});

describe('ChooseResult (compile-time check)', () => {
  it('T-SET-2 a refusal can carry the action’s retry wait (checked by the type checker, not at run time)', () => {
    const refused: ChooseResult = { ok: false, messageKey: 'review.saveFailed', retryAfterSeconds: 30 };
    expect(refused.ok).toBe(false);
  });
});
