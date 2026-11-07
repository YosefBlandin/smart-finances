'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  dataKeys,
  FINAL_IMPORT_STATUSES,
  transactionFilters,
  type ImportRecord,
  type ImportsPage,
  type RatesReply,
  type ReviewReply,
  type TotalsRange,
  type TotalsReply,
  type TransactionFilters,
  type TransactionsPage,
  signedOutPath,
} from './keys';

// The data hooks (D-127, D-130): TanStack Query over the same-origin JSON routes /api/data/*, which add the person's
// token on the server, so the browser never holds one. Transactions page by the API's cursor (an infinite query); an
// import is polled, backing off, until it is final or stalled, for under 10 minutes. A refused answer becomes a
// DataError with its status and code, and only a failure worth repeating (502, 503, a network error) is retried, after
// the server's Retry-After when it gave one.

/** An answer other than 200 from /api/data/*: 401 signed out, 403 consent, 404, 409, 429 limited (retryAfter), 5xx. */
export class DataError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfter?: number,
  ) {
    super(`data ${status} ${code}`);
    this.name = 'DataError';
  }
}

/** The browser's page change, a seam for tests (jsdom has no navigation). */
export const browserNavigation = {
  go(url: string): void {
    window.location.assign(url);
  },
};

/**
 * GET a same-origin JSON route. A network failure is a DataError with status 0. A 401 (signed out: no live session, or
 * the data API refused the token after its one refresh) also sends the person to sign-in with this page's address kept,
 * through the signed-out route, which clears the ended session's cookie (architecture "Screen states", "Data access").
 */
export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: 'GET', credentials: 'same-origin', headers: { accept: 'application/json' }, signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new DataError(0, 'network');
  }
  if (res.ok) return (await res.json()) as T;
  let code = 'failed';
  try {
    const body = (await res.json()) as { error?: { code?: unknown } };
    if (typeof body.error?.code === 'string') code = body.error.code;
  } catch {
    // Not our JSON (a proxy's page): the status says enough.
  }
  if (res.status === 401) browserNavigation.go(signedOutPath(window.location.pathname + window.location.search));
  const wait = Number(res.headers.get('retry-after'));
  throw new DataError(res.status, code, Number.isFinite(wait) && wait > 0 ? wait : undefined);
}

/** The longest server wait (Retry-After, seconds) a retry sits out; a longer one is not retried. */
export const MAX_RETRY_WAIT_S = 30;

/** Retry twice, only for failures a retry can fix, and not when the server asks for a wait past MAX_RETRY_WAIT_S. */
export function retryable(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (!(error instanceof DataError)) return true;
  if (error.retryAfter !== undefined && error.retryAfter > MAX_RETRY_WAIT_S) return false;
  return error.status === 0 || error.status >= 500;
}

/** The wait before a retry: the server's Retry-After when it gave one (a throttled reply), else 1 s doubling; at most 30 s. */
export function retryDelay(failureCount: number, error: unknown): number {
  if (error instanceof DataError && error.retryAfter !== undefined) return Math.min(error.retryAfter, MAX_RETRY_WAIT_S) * 1_000;
  return Math.min(1_000 * 2 ** failureCount, MAX_RETRY_WAIT_S * 1_000);
}

/** A path with its search values; empty values are left out. */
export function dataPath(path: string, values: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(values)) if (v !== undefined && v !== '') search.set(k, String(v));
  const s = search.toString();
  return s ? `${path}?${s}` : path;
}

/** The transactions of one month, page by page (cursor). fetchNextPage() asks for the next one; hasNextPage says if there is one. */
export function useTransactions(filters: TransactionFilters) {
  const f = transactionFilters(filters);
  return useInfiniteQuery({
    queryKey: dataKeys.transactions(filters),
    queryFn: ({ pageParam, signal }) =>
      getJson<TransactionsPage>(
        dataPath('/api/data/transactions', {
          from: f.month,
          to: f.month,
          kind: f.kind,
          category: f.category,
          q: f.q,
          sort: f.sort,
          order: f.order,
          limit: f.limit,
          cursor: pageParam,
        }),
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.cursor,
    retry: retryable,
    retryDelay,
  });
}

export function useTotals(range: TotalsRange) {
  return useQuery({
    queryKey: dataKeys.totals(range),
    queryFn: ({ signal }) => getJson<TotalsReply>(dataPath('/api/data/totals', { from: range.from, to: range.to, view: range.view }), signal),
    retry: retryable,
    retryDelay,
  });
}

export function useRates() {
  return useQuery({
    queryKey: dataKeys.rates(),
    queryFn: ({ signal }) => getJson<RatesReply>('/api/data/rates', signal),
    retry: retryable,
    retryDelay,
  });
}

export function useReview() {
  return useQuery({
    queryKey: dataKeys.review(),
    queryFn: ({ signal }) => getJson<ReviewReply>('/api/data/review', signal),
    retry: retryable,
    retryDelay,
  });
}

export function useImports() {
  return useQuery({
    queryKey: dataKeys.imports(),
    queryFn: ({ signal }) => getJson<ImportsPage>('/api/data/imports', signal),
    retry: retryable,
    retryDelay,
  });
}

/** How an import is polled: every 3 s, doubling to 30 s, for at most 23 reads (under 10 minutes). */
export const IMPORT_POLL = { intervalMs: 3_000, maxIntervalMs: 30_000, maxPolls: 23 } as const;
type ImportPoll = { intervalMs?: number; maxIntervalMs?: number; maxPolls?: number };

/** Statuses after which polling stops: the final ones, and stalled, which waits for a repair rather than for time. */
const SETTLED_IMPORT_STATUSES: readonly string[] = [...FINAL_IMPORT_STATUSES, 'stalled'];

/** The wait after the reads-th read of an import (1-based), or false once maxPolls reads were made. */
export function importPollDelay(reads: number, poll: ImportPoll = {}): number | false {
  const { intervalMs, maxIntervalMs, maxPolls } = { ...IMPORT_POLL, ...poll };
  if (reads >= maxPolls) return false;
  return Math.min(intervalMs * 2 ** Math.max(reads - 1, 0), maxIntervalMs);
}

/**
 * One import, polled while it is not settled (importPollDelay: 3 s doubling to 30 s, at most 23 reads), so an idle
 * Imports screen stays well inside the person's data reads a minute. No polling once it is final or stalled, after a
 * refusal (not found, signed out, limited), or while id is empty.
 */
export function useImport(id: string | undefined, poll: ImportPoll = {}) {
  return useQuery({
    queryKey: dataKeys.import(id ?? ''),
    queryFn: ({ signal }) => getJson<ImportRecord>(`/api/data/imports/${encodeURIComponent(id ?? '')}`, signal),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      // A refusal ends the polling; a failure worth retrying keeps it, within the same cap.
      const error = query.state.error;
      if (error && !retryable(0, error)) return false;
      const status = query.state.data?.status;
      if (status !== undefined && SETTLED_IMPORT_STATUSES.includes(status)) return false;
      return importPollDelay(query.state.dataUpdateCount + query.state.errorUpdateCount, poll);
    },
    retry: retryable,
    retryDelay,
  });
}
