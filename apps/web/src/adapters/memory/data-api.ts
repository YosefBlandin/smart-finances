import { checkImportRequest, ROUTES } from '@smart-finances/contracts/routes';
import type { z } from 'zod';
import type { Clock } from '@/ports/clock';
import type { DataApi, DataApiFailure, DataApiResult } from '@/ports/data-api';

type Reply<M extends keyof DataApi> = Awaited<ReturnType<DataApi[M]>> extends DataApiResult<infer T> ? T : never;
type Tx = Reply<'listTransactions'>['items'][number];
type ImportRecord = Reply<'getImport'>;
type ListQuery = z.output<(typeof ROUTES)['GET /transactions']['request']>;
type Seed = { transactions?: Tx[]; rates?: Record<string, number>; imports?: ImportRecord[] };

const failed = (code: string): DataApiFailure => ({
  ok: false,
  kind: code === 'not_found' ? 'not_found' : code === 'conflict' ? 'conflict' : 'failed',
  code,
});
const done = <T>(data: T) => ({ ok: true as const, data });
const month = (day: string) => day.slice(0, 7);

// An in-memory data API for STAGE=test and Storybook: requests are parsed with the shared contracts, as the API does.
export class MemoryDataApi implements DataApi {
  private readonly tokens = new Set<string>();
  private readonly transactions = new Map<string, Tx>();
  private readonly rateMap = new Map<string, number>();
  private readonly imports = new Map<string, ImportRecord>();
  constructor(private readonly clock: Clock) {}

  allowToken(token: string) {
    this.tokens.add(token);
  }
  seed({ transactions = [], rates = {}, imports = [] }: Seed) {
    for (const t of transactions) this.transactions.set(t.id, structuredClone(t));
    for (const [m, v] of Object.entries(rates)) this.rateMap.set(m, v);
    for (const i of imports) this.imports.set(i.import_id, structuredClone(i));
  }

  private parse<K extends keyof typeof ROUTES>(token: string, route: K, input: unknown) {
    if (!this.tokens.has(token)) return { error: { ok: false, kind: 'unauthorized' } as DataApiFailure };
    const schema = (ROUTES[route] as { request?: { safeParse(v: unknown): { success: boolean; data?: unknown } } }).request;
    if (!schema) return { value: input };
    const r = schema.safeParse(input);
    return r.success ? { value: r.data } : { error: failed('bad_request') };
  }

  async listTransactions(token: string, input: Parameters<DataApi['listTransactions']>[1]) {
    const p = this.parse(token, 'GET /transactions', input);
    if (p.error) return p.error;
    const q = p.value as ListQuery;
    const dir = q.order === 'asc' ? 1 : -1;
    const rows = [...this.transactions.values()]
      .filter((t) => month(t.date) >= q.from && month(t.date) <= q.to)
      .filter((t) => (!q.category || t.category === q.category) && (!q.kind || t.kind === q.kind))
      .filter((t) => !q.q || `${t.merchant}`.toLowerCase().includes(q.q.toLowerCase()))
      .sort((a, b) => dir * (q.sort === 'amount' ? a.amount - b.amount : a.date.localeCompare(b.date)) || a.id.localeCompare(b.id));
    const start = q.cursor ? Number(q.cursor) : 0;
    const items = rows.slice(start, start + q.limit);
    const next = start + q.limit < rows.length ? String(start + q.limit) : undefined;
    return done({ items, ...(next ? { cursor: next } : {}) });
  }

  async totals(token: string, input: Parameters<DataApi['totals']>[1]) {
    const p = this.parse(token, 'GET /totals', input);
    if (p.error) return p.error;
    const { from, to } = p.value as { from: string; to: string };
    const months = new Map<string, Record<string, Record<string, Record<string, number>>>>();
    for (const t of this.transactions.values()) {
      const m = month(t.date);
      if (m < from || m > to) continue;
      const byKind = months.get(m) ?? {};
      const byCat = (byKind[t.kind] ??= {});
      const byCur = (byCat[t.category] ??= {});
      byCur[t.currency] = (byCur[t.currency] ?? 0) + t.amount;
      months.set(m, byKind);
    }
    const list = [...months.keys()].sort().map((m) => ({ month: m, totals: months.get(m) ?? {} }));
    return done({ months: list, missing_rates: list.map((m) => m.month).filter((m) => !this.rateMap.has(m)) });
  }

  async rates(token: string) {
    const p = this.parse(token, 'GET /rates', {});
    if (p.error) return p.error;
    return done({ items: [...this.rateMap].sort(([a], [b]) => a.localeCompare(b)).map(([m, ars_per_usd]) => ({ month: m, ars_per_usd })) });
  }

  async putRate(token: string, { month: m, ...body }: Parameters<DataApi['putRate']>[1]) {
    const p = this.parse(token, 'PUT /rates/{month}', body);
    if (p.error) return p.error;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return failed('bad_request');
    this.rateMap.set(m, body.ars_per_usd);
    return done({ month: m, ars_per_usd: body.ars_per_usd });
  }

  async review(token: string) {
    const p = this.parse(token, 'GET /review', {});
    if (p.error) return p.error;
    const items = [...this.transactions.values()].filter((t) => t.review.reasons.length > 0 && !t.review.approved);
    return done({ items: items.map(({ review, ...t }) => ({ ...t, reasons: review.reasons })) });
  }

  async putReview(token: string, { id, ...body }: Parameters<DataApi['putReview']>[1]) {
    const p = this.parse(token, 'PUT /transactions/{id}/review', body);
    if (p.error) return p.error;
    const t = this.transactions.get(id);
    if (!t || t.date !== body.date) return failed('not_found');
    if (body.category) t.category = body.category;
    if (body.approved !== undefined) t.review.approved = body.approved;
    return done({ review: structuredClone(t.review) });
  }

  async listImports(token: string, input: Parameters<DataApi['listImports']>[1]) {
    const p = this.parse(token, 'GET /imports', input);
    if (p.error) return p.error;
    return done({ items: [...this.imports.values()].map((i) => structuredClone(i)) });
  }

  async getImport(token: string, { id }: Parameters<DataApi['getImport']>[1]) {
    const p = this.parse(token, 'GET /imports/{id}', {});
    if (p.error) return p.error;
    const i = this.imports.get(id);
    return i ? done(structuredClone(i)) : failed('not_found');
  }

  async requestImport(token: string, input: Parameters<DataApi['requestImport']>[1]) {
    if (!this.tokens.has(token)) return { ok: false, kind: 'unauthorized' } as DataApiFailure;
    const check = checkImportRequest(input);
    if (!check.ok) return failed(check.code ?? 'bad_request');
    const import_id = `imp-${this.imports.size + 1}`;
    const expires_at = new Date(this.clock.now() + 15 * 60_000).toISOString();
    return done({ import_id, upload: { url: 'https://uploads.test.invalid/', fields: { key: import_id } }, expires_at });
  }

  async exportCsv(token: string) {
    const p = this.parse(token, 'GET /export', {});
    if (p.error) return p.error;
    const cols = ROUTES['GET /export'].columns as readonly string[];
    const cell = (v: unknown) => `"${String(Array.isArray(v) ? v.join(';') : (v ?? '')).replaceAll('"', '""')}"`;
    const lines = [...this.transactions.values()].map((t) => cols.map((c) => cell((t as Record<string, unknown>)[c])).join(','));
    return done([cols.join(','), ...lines].join('\n'));
  }

  async erase(token: string, input: Parameters<DataApi['erase']>[1]) {
    const p = this.parse(token, 'DELETE /data', input);
    if (p.error) return p.error;
    const items = this.transactions.size;
    this.transactions.clear();
    this.imports.clear();
    return done({ deleted: { items, files: 0 } });
  }
}
