import { checkImportRequest, ROUTES } from '@smart-finances/contracts/routes';
import type { z } from 'zod';
import type { LimitsDeps } from '@/application/limits';
import type { Clock } from '@/ports/clock';
import type { DataApi, DataApiFailure, DataApiResult } from '@/ports/data-api';
import type { Logger } from '@/ports/logger';
import hostile from '../../../fixtures/hostile.json';
import sample from '../../../fixtures/sample.json';
import { countPersonRequest, tokenSub } from '../data-api';

type Reply<M extends keyof DataApi> = Awaited<ReturnType<DataApi[M]>> extends DataApiResult<infer T> ? T : never;
type Tx = Reply<'listTransactions'>['items'][number];
type ImportRecord = Reply<'getImport'>;
type ListQuery = z.output<(typeof ROUTES)['GET /transactions']['request']>;
type Seed = { transactions?: Tx[]; rates?: Record<string, number>; imports?: ImportRecord[] };

// The fixtures as the prototype wrote them (apps/web/fixtures): rows carry flags and no review, imports short names.
type FixtureRow = Omit<Tx, 'review' | 'date_precision' | 'source_ref' | 'import_batch'> & { date_precision?: string };
type FixtureImport = {
  id: string;
  kind: string;
  source: string;
  file: string;
  period: string;
  status: string;
  created: string;
  finished?: string;
  active: boolean;
  counts?: ImportRecord['counts'];
  skipped?: { where: string; reason: { en: string; es: string } }[];
  error?: string;
};

const stamp = (s: string) => `${s.replace(' ', 'T')}:00Z`;

/**
 * The STAGE=test and Storybook data set (SF-161): fixtures/sample.json plus the adversarial rows of
 * data/synthetic/transactions.csv in fixtures/hostile.json, in the contract's shapes. Rows listed in reviewRows, and
 * every hostile row, are to review with their flags as reasons; payments-report rows are source mercadopago. A skipped
 * row keeps the importer's own words in English (D-86). Synthetic data only.
 */
export function fixtureSeed(): Required<Seed> {
  const toReview = new Set<string>(sample.reviewRows);
  const rows = [...(sample.transactions as FixtureRow[]), ...(hostile.transactions as FixtureRow[])];
  const hostileIds = new Set(hostile.transactions.map((t) => t.id));
  const transactions = rows.map((t): Tx => ({
    id: t.id,
    date: t.date,
    date_precision: t.date_precision === 'month' ? 'month' : 'day',
    kind: t.kind,
    amount: t.amount,
    currency: t.currency,
    category: t.category,
    merchant: t.merchant,
    description_raw: t.description_raw,
    source: t.source,
    source_ref: t.id,
    country: t.country,
    flags: [...t.flags],
    import_batch: 'fixture',
    review: { reasons: toReview.has(t.id) || hostileIds.has(t.id) ? [...t.flags] : [], approved: false },
  }));
  const imports = [...(sample.imports as FixtureImport[]), ...(hostile.imports as FixtureImport[])].map((i): ImportRecord => ({
    import_id: i.id,
    kind: i.kind as ImportRecord['kind'],
    source: i.source,
    file_name: i.file,
    period: i.period,
    status: i.status as ImportRecord['status'],
    created_at: stamp(i.created),
    ...(i.finished ? { finished_at: stamp(i.finished) } : {}),
    active: i.active,
    ...(i.counts ? { counts: i.counts } : {}),
    ...(i.skipped ? { skipped: i.skipped.map((s) => ({ where: s.where, reason: s.reason.en })) } : {}),
    ...(i.error ? { error: i.error } : {}),
  }));
  const rates = Object.fromEntries(Object.entries(sample.rates).map(([m, v]) => [m, Number(v)]));
  return { transactions, rates, imports };
}

/** How long an import requested from this fake runs before it is done (SF-167): its upload is not seen here. */
export const MEMORY_IMPORT_RUN_MS = 2_000;

/** The period an import covers, as far as its file name tells: yyyy-mm, the notes log, or not known. */
function periodOf(source: string, fileName: string): string {
  if (source === 'notion') return 'log';
  const m = /(\d{4})-(0[1-9]|1[0-2])/.exec(fileName);
  return m ? `${m[1]}-${m[2]}` : '—';
}

const failed = (code: string): DataApiFailure => ({
  ok: false,
  kind: code === 'not_found' ? 'not_found' : code === 'conflict' ? 'conflict' : 'failed',
  code,
});
const done = <T>(data: T) => ({ ok: true as const, data });
const month = (day: string) => day.slice(0, 7);

// An in-memory data API for STAGE=test and Storybook: requests are parsed with the shared contracts, as the API does.
// One data set for every allowed token. Given limits, each call counts against the person's limit (the token's sub,
// else the token) like the real adapter, so STAGE=test reaches the 429 page at 5 a minute.
export class MemoryDataApi implements DataApi {
  private readonly tokens = new Set<string>();
  private readonly transactions = new Map<string, Tx>();
  private readonly rateMap = new Map<string, number>();
  private readonly imports = new Map<string, ImportRecord>();
  /** Imports requested from this fake, with when: each is importing, then done with two skipped rows (SF-167). */
  private readonly requested = new Map<string, number>();
  private nextImport = 1;
  constructor(
    private readonly clock: Clock,
    private readonly opts: { limits?: LimitsDeps; logger?: Logger; eraseFailures?: number } = {},
  ) {}
  private erasesFailed = 0;

  allowToken(token: string) {
    this.tokens.add(token);
  }
  seed({ transactions = [], rates = {}, imports = [] }: Seed) {
    for (const t of transactions) this.transactions.set(t.id, structuredClone(t));
    for (const [m, v] of Object.entries(rates)) this.rateMap.set(m, v);
    for (const i of imports) this.imports.set(i.import_id, structuredClone(i));
  }

  /** The token check, then the person's count. */
  private async gate(token: string): Promise<DataApiFailure | undefined> {
    if (!this.tokens.has(token)) return { ok: false, kind: 'unauthorized' };
    const { limits, logger } = this.opts;
    return limits ? countPersonRequest({ ...limits, logger }, tokenSub(token) ?? token) : undefined;
  }

  private async parse<K extends keyof typeof ROUTES>(token: string, route: K, input: unknown) {
    const refused = await this.gate(token);
    if (refused) return { error: refused };
    const schema = (ROUTES[route] as { request?: { safeParse(v: unknown): { success: boolean; data?: unknown } } }).request;
    if (!schema) return { value: input };
    const r = schema.safeParse(input);
    return r.success ? { value: r.data } : { error: failed('bad_request') };
  }

  async listTransactions(token: string, input: Parameters<DataApi['listTransactions']>[1]) {
    const p = await this.parse(token, 'GET /transactions', input);
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
    const p = await this.parse(token, 'GET /totals', input);
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
    const p = await this.parse(token, 'GET /rates', {});
    if (p.error) return p.error;
    return done({ items: [...this.rateMap].sort(([a], [b]) => a.localeCompare(b)).map(([m, ars_per_usd]) => ({ month: m, ars_per_usd })) });
  }

  async putRate(token: string, { month: m, ...body }: Parameters<DataApi['putRate']>[1]) {
    const p = await this.parse(token, 'PUT /rates/{month}', body);
    if (p.error) return p.error;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return failed('bad_request');
    this.rateMap.set(m, body.ars_per_usd);
    return done({ month: m, ars_per_usd: body.ars_per_usd });
  }

  async review(token: string) {
    const p = await this.parse(token, 'GET /review', {});
    if (p.error) return p.error;
    const items = [...this.transactions.values()].filter((t) => t.review.reasons.length > 0 && !t.review.approved);
    return done({ items: items.map(({ review, ...t }) => ({ ...t, reasons: review.reasons })) });
  }

  async putReview(token: string, { id, ...body }: Parameters<DataApi['putReview']>[1]) {
    const p = await this.parse(token, 'PUT /transactions/{id}/review', body);
    if (p.error) return p.error;
    const t = this.transactions.get(id);
    if (!t || t.date !== body.date) return failed('not_found');
    if (body.category) t.category = body.category;
    if (body.approved !== undefined) t.review.approved = body.approved;
    return done({ review: structuredClone(t.review) });
  }

  async listImports(token: string, input: Parameters<DataApi['listImports']>[1]) {
    const p = await this.parse(token, 'GET /imports', input);
    if (p.error) return p.error;
    const items = [...this.imports.values()].map((i) => this.progress(i));
    return done({ items: items.sort((a, b) => b.created_at.localeCompare(a.created_at)) });
  }

  async getImport(token: string, { id }: Parameters<DataApi['getImport']>[1]) {
    const p = await this.parse(token, 'GET /imports/{id}', {});
    if (p.error) return p.error;
    const i = this.imports.get(id);
    return i ? done(this.progress(i)) : failed('not_found');
  }

  /** A copy of the record; one requested here shows importing, then done once MEMORY_IMPORT_RUN_MS have passed. */
  private progress(i: ImportRecord): ImportRecord {
    const copy = structuredClone(i);
    const at = this.requested.get(i.import_id);
    if (at === undefined) return copy;
    if (this.clock.now() - at < MEMORY_IMPORT_RUN_MS) return { ...copy, status: 'importing' };
    return {
      ...copy,
      status: 'done',
      active: true,
      finished_at: new Date(at + MEMORY_IMPORT_RUN_MS).toISOString(),
      counts: { added: 12, updated: 0, removed: 0, skipped: 2 },
      // The importer's own words, in English (D-86). Synthetic.
      skipped: [
        { where: 'row 7', reason: 'the amount is not a number' },
        { where: 'row 12', reason: 'the date is outside the month' },
      ],
    };
  }

  async requestImport(token: string, input: Parameters<DataApi['requestImport']>[1]) {
    const refused = await this.gate(token);
    if (refused) return refused;
    const check = checkImportRequest(input);
    if (!check.ok) return failed(check.code ?? 'bad_request');
    const import_id = `imp-${String(this.nextImport++).padStart(4, '0')}`;
    const now = this.clock.now();
    const expires_at = new Date(now + 15 * 60_000).toISOString();
    this.imports.set(import_id, {
      import_id,
      kind: 'file',
      source: input.source,
      file_name: input.file_name,
      period: periodOf(input.source, input.file_name),
      status: 'requested',
      created_at: new Date(now).toISOString(),
      active: false,
    });
    this.requested.set(import_id, now);
    return done({ import_id, upload: { url: 'https://uploads.test.invalid/', fields: { key: import_id } }, expires_at });
  }

  async exportCsv(token: string) {
    const p = await this.parse(token, 'GET /export', {});
    if (p.error) return p.error;
    const cols = ROUTES['GET /export'].columns as readonly string[];
    const cell = (v: unknown) => `"${String(Array.isArray(v) ? v.join(';') : (v ?? '')).replaceAll('"', '""')}"`;
    const lines = [...this.transactions.values()].map((t) => cols.map((c) => cell((t as Record<string, unknown>)[c])).join(','));
    return done([cols.join(','), ...lines].join('\n'));
  }

  /**
   * Erase all (SF-168): like DELETE /data, refused with conflict while an import requested here still runs; else every
   * transaction, rate and import goes, counted as records, with one file per import. Given eraseFailures, the first
   * that many erases fail as a timeout would, before anything is erased (the "may be unfinished" state, AC-7).
   */
  async erase(token: string, input: Parameters<DataApi['erase']>[1]) {
    const p = await this.parse(token, 'DELETE /data', input);
    if (p.error) return p.error;
    if (this.erasesFailed < (this.opts.eraseFailures ?? 0)) {
      this.erasesFailed += 1;
      return { ok: false as const, kind: 'failed' as const, code: 'timeout' };
    }
    const now = this.clock.now();
    if ([...this.requested.values()].some((at) => now - at < MEMORY_IMPORT_RUN_MS)) return failed('conflict');
    const files = this.imports.size;
    const items = this.transactions.size + this.rateMap.size + files;
    this.transactions.clear();
    this.rateMap.clear();
    this.imports.clear();
    this.requested.clear();
    return done({ deleted: { items, files } });
  }
}

/** A data API whose every call fails as the API being down would (STAGE=test people for the failed states, AC-8). */
export class FailingDataApi implements DataApi {
  private readonly fail = async (): Promise<DataApiFailure> => ({ ok: false, kind: 'failed', code: 'server' });
  listTransactions = this.fail;
  totals = this.fail;
  rates = this.fail;
  putRate = this.fail;
  review = this.fail;
  putReview = this.fail;
  listImports = this.fail;
  getImport = this.fail;
  requestImport = this.fail;
  exportCsv = this.fail;
  erase = this.fail;
}

/**
 * STAGE=test: a data API that serves its first `served` calls through inner, then refuses the token as the real one does
 * once its one refresh fails (architecture "Data access": 401, one refresh, then signed out). With served 0 it refuses
 * every call. For the signed-out browser tests (SF-164, SF-165).
 */
export class RefusingDataApi implements DataApi {
  private calls = 0;
  constructor(
    private readonly inner: DataApi,
    private readonly served: number,
  ) {}
  private pass<A extends unknown[], R>(call: (...args: A) => Promise<R>) {
    return async (...args: A): Promise<R | DataApiFailure> => {
      if (this.calls >= this.served) return { ok: false, kind: 'unauthorized' };
      this.calls += 1;
      return call(...args);
    };
  }
  listTransactions: DataApi['listTransactions'] = this.pass((t, i) => this.inner.listTransactions(t, i));
  totals: DataApi['totals'] = this.pass((t, i) => this.inner.totals(t, i));
  rates: DataApi['rates'] = this.pass((t, i) => this.inner.rates(t, i));
  putRate: DataApi['putRate'] = this.pass((t, i) => this.inner.putRate(t, i));
  review: DataApi['review'] = this.pass((t, i) => this.inner.review(t, i));
  putReview: DataApi['putReview'] = this.pass((t, i) => this.inner.putReview(t, i));
  listImports: DataApi['listImports'] = this.pass((t, i) => this.inner.listImports(t, i));
  getImport: DataApi['getImport'] = this.pass((t, i) => this.inner.getImport(t, i));
  requestImport: DataApi['requestImport'] = this.pass((t, i) => this.inner.requestImport(t, i));
  exportCsv: DataApi['exportCsv'] = this.pass((t, i) => this.inner.exportCsv(t, i));
  erase: DataApi['erase'] = this.pass((t, i) => this.inner.erase(t, i));
}

/**
 * STAGE=test: one data API per person, picked by the access token, so a browser test that changes data (a review
 * choice, a rate, an import) changes only its own person's copy of the fixtures and never another test's (SF-166).
 */
export class PersonDataApis implements DataApi {
  private readonly byToken = new Map<string, DataApi>();
  /**
   * fallback answers an unknown token. newcomer, when given, instead makes an unknown token a data API of its own on
   * first use (a person who signed up in a browser test: no data yet, as on a real stage).
   */
  constructor(
    private readonly fallback: DataApi,
    private readonly newcomer?: (token: string) => DataApi,
  ) {}
  add(token: string, api: DataApi) {
    this.byToken.set(token, api);
  }
  private pick(token: string): DataApi {
    const known = this.byToken.get(token);
    if (known) return known;
    if (!this.newcomer) return this.fallback;
    const api = this.newcomer(token);
    this.byToken.set(token, api);
    return api;
  }
  listTransactions: DataApi['listTransactions'] = (token, input) => this.pick(token).listTransactions(token, input);
  totals: DataApi['totals'] = (token, input) => this.pick(token).totals(token, input);
  rates: DataApi['rates'] = (token, input) => this.pick(token).rates(token, input);
  putRate: DataApi['putRate'] = (token, input) => this.pick(token).putRate(token, input);
  review: DataApi['review'] = (token, input) => this.pick(token).review(token, input);
  putReview: DataApi['putReview'] = (token, input) => this.pick(token).putReview(token, input);
  listImports: DataApi['listImports'] = (token, input) => this.pick(token).listImports(token, input);
  getImport: DataApi['getImport'] = (token, input) => this.pick(token).getImport(token, input);
  requestImport: DataApi['requestImport'] = (token, input) => this.pick(token).requestImport(token, input);
  exportCsv: DataApi['exportCsv'] = (token, input) => this.pick(token).exportCsv(token, input);
  erase: DataApi['erase'] = (token, input) => this.pick(token).erase(token, input);
}
