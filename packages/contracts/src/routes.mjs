// One Zod schema per request and reply of the data API, as listed in
// docs/specs/data-architecture/architecture.md, Contracts "HTTP routes". The API validates with these and the web
// app parses replies with them, so neither keeps its own copy (D-133, D-124). Browser-safe.
import { z } from 'zod';
import { CATEGORIES } from './categories.mjs';
import { FIELDS, KINDS } from './fields.mjs';

const MiB = 1024 * 1024;

// ---- errors: { "error": { "code", "message" } } ----
export const ERROR_CODES = { unauthorized: 401, bad_request: 400, not_found: 404, conflict: 409, source_file_only: 409, too_large: 413 };
export const ErrorBody = z.object({ error: z.object({ code: z.enum(Object.keys(ERROR_CODES)), message: z.string() }) });

// ---- building blocks ----
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month as yyyy-mm');
const Day = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'date as yyyy-mm-dd');
const Cents = z.number().int(); // money is integer cents, never a float
const Cursor = z.string().min(1).max(2048);
const Timestamp = z.string().min(1);
const monthIndex = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5)) - 1;
const inOrder = (o) => monthIndex(o.from) <= monthIndex(o.to);
const spanAtMost36 = (o) => monthIndex(o.to) - monthIndex(o.from) + 1 <= 36;
const MonthRange = { from: Month, to: Month };

export const Transaction = z.object({
  id: z.string().min(1),
  date: Day,
  date_precision: z.enum(['day', 'month']),
  kind: z.enum(KINDS),
  amount: Cents,
  currency: z.string().regex(/^[A-Z]{3}$/),
  category: z.string(),
  merchant: z.string(),
  description_raw: z.string(),
  source: z.string(),
  source_ref: z.string(),
  country: z.string(),
  flags: z.array(z.string()),
  import_batch: z.string(),
});
// The row and the field list must never drift apart: the CSV export and the table both come from FIELDS.
if (Object.keys(Transaction.shape).join() !== FIELDS.join()) throw new Error('Transaction schema and FIELDS differ');

export const Review = z.object({
  reasons: z.array(z.string()),
  category_override: z.string().optional(),
  approved: z.boolean(),
  updated_at: Timestamp.optional(),
});

// ---- import sources: file name rule and size cap (POST /imports) ----
const MONTH_NAMES = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
const csv = { extension: '.csv', pattern: /^[^/\\]+\.csv$/i, maxBytes: 5 * MiB };
export const SOURCES = {
  mercadopago: csv,
  csv,
  notion: { extension: '.md', pattern: /^[^/\\]+\.md$/i, maxBytes: 5 * MiB },
  excel: { extension: '.xlsx', pattern: new RegExp(`^[^/\\\\]+_(${MONTH_NAMES})_\\d{4}\\.xlsx$`, 'i'), maxBytes: 20 * MiB },
};

// The same checks the API makes, so the web can say what is wrong before it uploads anything.
export function checkImportRequest({ source, file_name, size }) {
  const rule = Object.hasOwn(SOURCES, source) ? SOURCES[source] : null;
  if (!rule) return { ok: false, code: 'bad_request', message: 'Unknown source.' };
  if (!Number.isInteger(size) || size < 1) return { ok: false, code: 'bad_request', message: 'The file is empty.' };
  if (typeof file_name !== 'string' || !rule.pattern.test(file_name)) return { ok: false, code: 'bad_request', message: `The file name does not fit this source (${rule.extension}).` };
  if (size > rule.maxBytes) return { ok: false, code: 'too_large', message: `The file is over ${rule.maxBytes / MiB} MiB.` };
  return { ok: true };
}

// ---- imports ----
export const IMPORT_STATUSES = ['requested', 'importing', 'reconciling', 'done', 'unchanged', 'superseded', 'failed', 'expired', 'stalled'];
const ImportCounts = z.object({ added: z.number().int(), updated: z.number().int(), removed: z.number().int(), skipped: z.number().int() });
const ImportItem = z.object({
  import_id: z.string().min(1),
  source: z.string(),
  file_name: z.string(),
  period: z.string(),
  status: z.enum(IMPORT_STATUSES),
  created_at: Timestamp,
  finished_at: Timestamp.optional(),
  counts: ImportCounts.optional(),
  active: z.boolean(),
});
const ImportRecord = ImportItem.extend({
  kind: z.enum(['file', 'undo', 'repair']).optional(),
  error: z.string().optional(),
  skipped: z.array(z.object({ where: z.string(), reason: z.string() })).optional(),
});
const Accepted = z.object({ import_id: z.string().min(1) });

// ---- the routes ----
export const ROUTES = {
  'GET /health': { reply: z.object({ message: z.string(), stage: z.string() }) },
  'POST /imports': {
    request: z.object({ source: z.enum(Object.keys(SOURCES)), file_name: z.string().min(1), size: z.number().int().positive() })
      .refine((o) => SOURCES[o.source].pattern.test(o.file_name), { message: 'file name does not fit the source', path: ['file_name'] }),
    reply: z.object({ import_id: z.string().min(1), upload: z.object({ url: z.string().url(), fields: z.record(z.string(), z.string()) }), expires_at: Timestamp }),
  },
  'GET /imports': { request: z.object({ cursor: Cursor.optional() }), reply: z.object({ items: z.array(ImportItem), cursor: Cursor.optional() }) },
  'GET /imports/{id}': { reply: ImportRecord },
  'POST /imports/{id}/undo': { reply: Accepted },
  'POST /periods/{source}/{period}/repair': { reply: Accepted },
  'GET /transactions': {
    request: z.object({
      ...MonthRange,
      category: z.string().optional(),
      kind: z.enum(KINDS).optional(),
      q: z.string().max(200).optional(),
      sort: z.enum(['date', 'amount']).default('date'),
      order: z.enum(['asc', 'desc']).default('desc'),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      cursor: Cursor.optional(),
    }).refine(inOrder, { message: 'from is after to' }).refine(spanAtMost36, { message: 'at most 36 months' }),
    reply: z.object({ items: z.array(Transaction.extend({ review: Review })), cursor: Cursor.optional() }),
  },
  'GET /totals': {
    request: z.object({ ...MonthRange, view: z.enum(['native', 'usd']).default('native') }).refine(inOrder, { message: 'from is after to' }),
    reply: z.object({
      // kind, then category, then currency, to integer cents
      months: z.array(z.object({ month: Month, totals: z.record(z.string(), z.record(z.string(), z.record(z.string(), Cents))) })),
      missing_rates: z.array(Month),
    }),
  },
  'GET /review': { reply: z.object({ items: z.array(Transaction.extend({ reasons: z.array(z.string()) })) }) },
  'PUT /transactions/{id}/review': {
    request: z.object({ date: Day, category: z.enum(CATEGORIES).optional(), approved: z.boolean().optional() }),
    reply: z.object({ review: Review }),
  },
  'GET /rates': { reply: z.object({ items: z.array(z.object({ month: Month, ars_per_usd: z.number().positive() })) }) },
  'PUT /rates/{month}': {
    // two decimals, as the rates screen keeps them
    request: z.object({ ars_per_usd: z.number().positive().refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, { message: 'at most two decimals' }) }),
    reply: z.object({ month: Month, ars_per_usd: z.number().positive() }),
  },
  'POST /totals/rebuild': { reply: z.object({ months: z.number().int().min(0) }) },
  'GET /export': { contentType: 'text/csv', columns: FIELDS, reply: z.string() },
  'DELETE /data': { request: z.object({ confirm: z.literal('DELETE') }), reply: z.object({ deleted: z.object({ items: z.number().int().min(0), files: z.number().int().min(0) }) }) },
};
