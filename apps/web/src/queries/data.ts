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
} from './keys';

// The data hooks (D-127, D-130): TanStack Query over the same-origin JSON routes /api/data/*, which add the person's
// token on the server, so the browser never holds one. Transactions page by the API's cursor (an infinite query); an
// import is polled until it reaches a final status. A refused answer becomes a DataError with its status and code, and
// only a failure worth repeating (502, 503, a network error) is retried.

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

/** GET a same-origin JSON route. A network failure is a DataError with status 0. */
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
  const wait = Number(res.headers.get('retry-after'));
  throw new DataError(res.status, code, Number.isFinite(wait) && wait > 0 ? wait : undefined);
}

/** Retry twice, only for failures a retry can fix. */
export function retryable(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (!(error instanceof DataError)) return true;
  return error.status === 0 || error.status >= 500;
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
  });
}

export function useTotals(range: TotalsRange) {
  return useQuery({
    queryKey: dataKeys.totals(range),
    queryFn: ({ signal }) => getJson<TotalsReply>(dataPath('/api/data/totals', { from: range.from, to: range.to, view: range.view }), signal),
    retry: retryable,
  });
}

export function useRates() {
  return useQuery({ queryKey: dataKeys.rates(), queryFn: ({ signal }) => getJson<RatesReply>('/api/data/rates', signal), retry: retryable });
}

export function useReview() {
  return useQuery({ queryKey: dataKeys.review(), queryFn: ({ signal }) => getJson<ReviewReply>('/api/data/review', signal), retry: retryable });
}

export function useImports() {
  return useQuery({ queryKey: dataKeys.imports(), queryFn: ({ signal }) => getJson<ImportsPage>('/api/data/imports', signal), retry: retryable });
}

/** Every intervalMs while the import is not final (3 seconds by default); no polling once it is, or while id is empty. */
export function useImport(id: string | undefined, { intervalMs = 3_000 }: { intervalMs?: number } = {}) {
  return useQuery({
    queryKey: dataKeys.import(id ?? ''),
    queryFn: ({ signal }) => getJson<ImportRecord>(`/api/data/imports/${encodeURIComponent(id ?? '')}`, signal),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      // A refusal (not found, signed out, limited) ends the polling; a failure worth retrying keeps it.
      const error = query.state.error;
      if (error && !retryable(0, error)) return false;
      const status = query.state.data?.status;
      return status !== undefined && FINAL_IMPORT_STATUSES.includes(status) ? false : intervalMs;
    },
    retry: retryable,
  });
}
