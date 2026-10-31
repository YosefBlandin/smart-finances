import type { ROUTES } from '@smart-finances/contracts/routes';
import type { z } from 'zod';

type Route = keyof typeof ROUTES;
type In<K extends Route> = (typeof ROUTES)[K] extends { request: z.ZodType } ? z.input<(typeof ROUTES)[K]['request']> : Record<string, never>;
type Out<K extends Route> = z.output<(typeof ROUTES)[K]['reply']>;

export type DataApiFailure = {
  ok: false;
  kind: 'unauthorized' | 'not_found' | 'conflict' | 'limited' | 'failed';
  code?: string;
  retryAfter?: number;
};
export type DataApiResult<T> = { ok: true; data: T } | DataApiFailure;
type Call<I, O> = (token: string, input: I) => Promise<DataApiResult<O>>;

// One method per data route in @smart-finances/contracts; path values travel in the input.
export interface DataApi {
  listTransactions: Call<In<'GET /transactions'>, Out<'GET /transactions'>>;
  totals: Call<In<'GET /totals'>, Out<'GET /totals'>>;
  rates: Call<In<'GET /rates'>, Out<'GET /rates'>>;
  putRate: Call<In<'PUT /rates/{month}'> & { month: string }, Out<'PUT /rates/{month}'>>;
  review: Call<In<'GET /review'>, Out<'GET /review'>>;
  putReview: Call<In<'PUT /transactions/{id}/review'> & { id: string }, Out<'PUT /transactions/{id}/review'>>;
  listImports: Call<In<'GET /imports'>, Out<'GET /imports'>>;
  getImport: Call<{ id: string }, Out<'GET /imports/{id}'>>;
  requestImport: Call<In<'POST /imports'>, Out<'POST /imports'>>;
  exportCsv: Call<In<'GET /export'>, Out<'GET /export'>>;
  erase: Call<In<'DELETE /data'>, Out<'DELETE /data'>>;
}
