import type { ROUTES } from '@smart-finances/contracts/routes';
import type { z } from 'zod';

// Query keys and reply types for the data hooks (D-127, D-130). No 'use client': the money pages' server prefetch uses
// the same keys, so the hydrated first view is the one the hooks read. Each key holds every value its request depends
// on (month range, view, filters, free text, id), so a change asks for that data and an unchanged one reuses the cache.

type Reply<K extends keyof typeof ROUTES> = z.output<(typeof ROUTES)[K]['reply']>;
export type TransactionsPage = Reply<'GET /transactions'>;
export type Transaction = TransactionsPage['items'][number];
export type TotalsReply = Reply<'GET /totals'>;
export type RatesReply = Reply<'GET /rates'>;
export type ReviewReply = Reply<'GET /review'>;
export type ImportsPage = Reply<'GET /imports'>;
export type ImportRecord = Reply<'GET /imports/{id}'>;

/** One month of transactions (the screen's month, D-82), with its filters; free text stays out of the page address. */
export type TransactionFilters = {
  month: string;
  kind?: string;
  category?: string;
  q?: string;
  sort?: 'date' | 'amount';
  order?: 'asc' | 'desc';
  /** Page size; 50 when not given. */
  limit?: number;
};
export type TotalsRange = { from: string; to: string; view: 'native' | 'usd' };

/** The transactions screen's page size (SF-165). */
export const PAGE_SIZE = 50;

/** Statuses after which an import no longer changes (data spec "Import record"; stalled waits for a repair). */
export const FINAL_IMPORT_STATUSES: readonly string[] = ['done', 'unchanged', 'superseded', 'failed', 'expired'];

/** Defaults filled in, so the same filters always make the same key. */
export function transactionFilters(f: TransactionFilters): Required<Omit<TransactionFilters, 'kind' | 'category' | 'q'>> & TransactionFilters {
  return { ...f, sort: f.sort ?? 'date', order: f.order ?? 'desc', limit: f.limit ?? PAGE_SIZE };
}

export const dataKeys = {
  all: ['data'] as const,
  transactions: (f: TransactionFilters) => ['data', 'transactions', transactionFilters(f)] as const,
  totals: (r: TotalsRange) => ['data', 'totals', { from: r.from, to: r.to, view: r.view }] as const,
  rates: () => ['data', 'rates'] as const,
  review: () => ['data', 'review'] as const,
  imports: () => ['data', 'imports'] as const,
  import: (id: string) => ['data', 'imports', id] as const,
};

/**
 * Where a signed-out person goes (architecture "Screen states": to sign-in, path kept): GET /api/data/signed-out clears
 * the cookie of a session that is gone and opens /sign-in?next=<address>. address is a path with its search values.
 */
export function signedOutPath(address: string): string {
  return `/api/data/signed-out?next=${encodeURIComponent(address)}`;
}
