// T-WEB-2 (AC-6, D-133, D-124): one shared home for the field lists, the categories and a schema per data route.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CATEGORIES } from '../src/categories.mjs';
import { FIELDS, KINDS } from '../src/fields.mjs';
import { ERROR_CODES, ROUTES, SOURCES, checkImportRequest, ErrorBody } from '../src/routes.mjs';
import { FIELDS as apiFields, KINDS as apiKinds } from '../../../apps/api/src/ingest/schema.mjs';
import { categoryFor } from '../../../apps/api/src/ingest/categories.mjs';

const MiB = 1024 * 1024;
const ok = (route, part, value) => ROUTES[route][part].safeParse(value);

test('T-WEB-2 exports the field list, kinds and categories', () => {
  assert.equal(FIELDS.length, 14);
  assert.deepEqual(FIELDS.slice(0, 4), ['id', 'date', 'date_precision', 'kind']);
  assert.deepEqual(KINDS, ['expense', 'income', 'inflow', 'refund', 'interest', 'transfer_out', 'loan_out']);
  assert.equal(CATEGORIES.at(-1), 'Uncategorized');
  assert.equal(CATEGORIES[0], 'Partner');
  assert.equal(new Set(CATEGORIES).size, CATEGORIES.length);
});

test('T-WEB-2 the API re-exports are unchanged and every rule category is in CATEGORIES', () => {
  assert.equal(apiFields, FIELDS);
  assert.equal(apiKinds, KINDS);
  for (const label of ['girl', 'food out', 'food', 'uber', 'rent', 'gym', 'nails', 'chatgpt', 'iphone', 'lamps', 'clothes', 'tickets', 'mother', 'gift', 'debt', 'management', 'cash', 'zzz unknown']) {
    assert.ok(CATEGORIES.includes(categoryFor(label)), `${label} -> ${categoryFor(label)}`);
  }
  assert.equal(categoryFor('zzz unknown'), 'Uncategorized');
});

test('T-WEB-2 there is a schema for every route in the data architecture table', () => {
  const doc = readFileSync(fileURLToPath(new URL('../../../docs/specs/data-architecture/architecture.md', import.meta.url)), 'utf8');
  const section = doc.split('### HTTP routes')[1].split('\n### ')[0];
  const rows = [...section.matchAll(/^\| ((?:GET|POST|PUT|DELETE) \/\S*)/gm)].map((m) => m[1]);
  assert.ok(rows.length >= 14, `found ${rows.length} routes in the table`);
  for (const r of rows) {
    assert.ok(ROUTES[r], `no schema for ${r}`);
    assert.ok('reply' in ROUTES[r], `${r} has no reply schema`);
  }
  assert.deepEqual(Object.keys(ROUTES).sort(), [...rows].sort());
});

test('T-WEB-2 error shape and codes', () => {
  assert.deepEqual(ERROR_CODES, { unauthorized: 401, bad_request: 400, not_found: 404, conflict: 409, source_file_only: 409, too_large: 413 });
  assert.ok(ErrorBody.safeParse({ error: { code: 'not_found', message: 'No such import.' } }).success);
  assert.ok(!ErrorBody.safeParse({ error: { code: 'teapot', message: 'x' } }).success);
  assert.ok(!ErrorBody.safeParse({ error: { code: 'conflict' } }).success);
});

test('T-WEB-2 sources: file name rules and size caps', () => {
  assert.equal(SOURCES.mercadopago.maxBytes, 5 * MiB);
  assert.equal(SOURCES.csv.maxBytes, 5 * MiB);
  assert.equal(SOURCES.notion.maxBytes, 5 * MiB);
  assert.equal(SOURCES.excel.maxBytes, 20 * MiB);
  const good = (source, file_name, size = 1000) => checkImportRequest({ source, file_name, size });
  assert.deepEqual(good('mercadopago', 'release-report-2026-09.csv'), { ok: true });
  assert.deepEqual(good('csv', 'rows.csv'), { ok: true });
  assert.deepEqual(good('notion', 'notes-log-export.md'), { ok: true });
  assert.deepEqual(good('excel', 'budget_Sep_2026.xlsx'), { ok: true });
  assert.equal(good('mercadopago', 'report.xlsx').code, 'bad_request');
  assert.equal(good('notion', 'notes.csv').code, 'bad_request');
  assert.equal(good('excel', 'budget_june.xlsx').code, 'bad_request');
  assert.equal(good('excel', 'budget_Sep_2026.xlsx', 20 * MiB + 1).code, 'too_large');
  assert.deepEqual(good('excel', 'budget_Sep_2026.xlsx', 20 * MiB), { ok: true });
  assert.equal(good('mercadopago', 'a.csv', 5 * MiB + 1).code, 'too_large');
  assert.equal(good('nope', 'a.csv').code, 'bad_request');
  assert.equal(good('mercadopago', 'a.csv', 0).code, 'bad_request');
});

test('T-WEB-2 POST /imports request and reply', () => {
  assert.ok(ok('POST /imports', 'request', { source: 'excel', file_name: 'budget_Sep_2026.xlsx', size: 4096 }).success);
  assert.ok(!ok('POST /imports', 'request', { source: 'excel', file_name: 'budget.xlsx', size: 4096 }).success);
  assert.ok(!ok('POST /imports', 'request', { source: 'excel', file_name: 'budget_Sep_2026.xlsx', size: 1.5 }).success);
  assert.ok(ok('POST /imports', 'reply', { import_id: '01JA7R2M9X', upload: { url: 'https://example.invalid/up', fields: { key: 'k' } }, expires_at: '2026-10-30T12:00:00Z' }).success);
  assert.ok(!ok('POST /imports', 'reply', { import_id: '01JA7R2M9X' }).success);
});

test('T-WEB-2 GET /imports and the import record carry the nine statuses', () => {
  const item = { import_id: 'a1', source: 'mercadopago', file_name: 'r.csv', period: '2026-09', status: 'done', created_at: '2026-10-02T18:40:00Z', finished_at: '2026-10-02T18:41:00Z', counts: { added: 212, updated: 0, removed: 0, skipped: 3 }, active: true };
  assert.ok(ok('GET /imports', 'reply', { items: [item], cursor: 'abc' }).success);
  for (const status of ['requested', 'importing', 'reconciling', 'done', 'unchanged', 'superseded', 'failed', 'expired', 'stalled']) {
    assert.ok(ok('GET /imports/{id}', 'reply', { ...item, status }).success, status);
  }
  assert.ok(!ok('GET /imports/{id}', 'reply', { ...item, status: 'sleeping' }).success);
  assert.ok(ok('POST /imports/{id}/undo', 'reply', { import_id: 'u1' }).success);
  assert.ok(ok('POST /periods/{source}/{period}/repair', 'reply', { import_id: 'r1' }).success);
});

test('T-WEB-2 GET /transactions query: months, limit, sort and the 36 month cap', () => {
  const q = (o) => ok('GET /transactions', 'request', { from: '2026-01', to: '2026-09', ...o });
  const parsed = q({}).data;
  assert.deepEqual([parsed.sort, parsed.order, parsed.limit], ['date', 'desc', 50]);
  assert.equal(q({ limit: '200' }).data.limit, 200);
  assert.ok(!q({ limit: '201' }).success);
  assert.ok(!q({ limit: '0' }).success);
  assert.ok(!q({ from: '2026-13' }).success);
  assert.ok(!q({ from: '2026-09', to: '2026-01' }).success);
  assert.ok(q({ from: '2024-01', to: '2026-12' }).success);
  assert.ok(!q({ from: '2023-12', to: '2026-12' }).success);
  assert.ok(!q({ kind: 'gift' }).success);
  assert.ok(!q({ sort: 'merchant' }).success);
});

test('T-WEB-2 transaction rows keep amounts as integer cents and carry the review choice', () => {
  const row = { id: '3f9a0c1e7b2d4a55', date: '2026-09-07', date_precision: 'day', kind: 'expense', amount: -8450000, currency: 'ARS', category: 'Groceries', merchant: 'Coto', description_raw: 'MP*COTO 0412', source: 'mercadopago', source_ref: 'row 3', country: 'AR', flags: ['possible_duplicate'], import_batch: 'mercadopago:abc123', review: { reasons: ['possible_duplicate'], approved: false } };
  assert.ok(ok('GET /transactions', 'reply', { items: [row] }).success);
  assert.ok(!ok('GET /transactions', 'reply', { items: [{ ...row, amount: -84500.5 }] }).success);
  assert.ok(!ok('GET /transactions', 'reply', { items: [{ ...row, review: undefined }] }).success);
  assert.ok(ok('GET /review', 'reply', { items: [{ ...row, reasons: ['needs_review'], review: undefined }] }).success);
  assert.ok(ok('PUT /transactions/{id}/review', 'request', { date: '2026-09-07', category: 'Groceries', approved: true }).success);
  assert.ok(!ok('PUT /transactions/{id}/review', 'request', { category: 'Groceries' }).success);
  assert.ok(ok('PUT /transactions/{id}/review', 'reply', { review: { reasons: [], category_override: 'Groceries', approved: true, updated_at: '2026-10-30T10:00:00Z' } }).success);
});

test('T-WEB-2 GET /totals, GET and PUT /rates, rebuild, export and DELETE /data', () => {
  assert.equal(ok('GET /totals', 'request', { from: '2026-01', to: '2026-09' }).data.view, 'native');
  assert.ok(!ok('GET /totals', 'request', { from: '2026-01', to: '2026-09', view: 'eur' }).success);
  assert.ok(ok('GET /totals', 'reply', { months: [{ month: '2026-09', totals: { expense: { Groceries: { ARS: 31000000, USD: 4500 } }, income: { Income: { USD: 200000 } } } }], missing_rates: ['2026-10'] }).success);
  assert.ok(!ok('GET /totals', 'reply', { months: [{ month: '2026-09', totals: { expense: { Groceries: { ARS: 310000.5 } } } }], missing_rates: [] }).success);
  assert.ok(ok('GET /rates', 'reply', { items: [{ month: '2026-09', ars_per_usd: 1394.5 }] }).success);
  assert.ok(ok('PUT /rates/{month}', 'request', { ars_per_usd: 1394.5 }).success);
  assert.ok(!ok('PUT /rates/{month}', 'request', { ars_per_usd: 0 }).success);
  assert.ok(!ok('PUT /rates/{month}', 'request', { ars_per_usd: 1394.555 }).success);
  assert.ok(ok('PUT /rates/{month}', 'reply', { month: '2026-09', ars_per_usd: 1394.5 }).success);
  assert.ok(ok('POST /totals/rebuild', 'reply', { months: 12 }).success);
  assert.deepEqual(ROUTES['GET /export'].columns, FIELDS);
  assert.ok(ok('DELETE /data', 'request', { confirm: 'DELETE' }).success);
  assert.ok(!ok('DELETE /data', 'request', { confirm: 'delete' }).success);
  assert.ok(!ok('DELETE /data', 'request', {}).success);
  assert.ok(ok('DELETE /data', 'reply', { deleted: { items: 553, files: 11 } }).success);
  assert.ok(ok('GET /health', 'reply', { message: 'ok', stage: 'qa' }).success);
});
