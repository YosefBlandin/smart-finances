// The one table every importer writes into. Amounts are integer cents in memory and fixed
// two-decimal strings on disk, so no float ever touches money.
import { createHash } from 'node:crypto';

export const FIELDS = [
  'id', // stable hash of the source identity, so re-importing never double-counts
  'date', // YYYY-MM-DD; for month-precision rows it is the 1st of the month
  'date_precision', // 'day' | 'month'
  'kind', // see KINDS
  'amount', // signed, money out is negative
  'currency', // ISO code as recorded at the source (ARS, USD)
  'category',
  'merchant', // cleaned name when the source has one, else empty
  'description_raw', // source text, kept for audit
  'source', // 'mercadopago' | 'notion'
  'source_ref', // where in the source the row came from
  'country', // where the money was spent (VE, AR)
  'flags', // '|'-separated notes for review, e.g. bcv_rate, summed, needs_review
  'import_batch', // hash of the source file, so one bad import can be rolled back
];

// Only `expense` counts as spending and only `income` as earnings. The rest move money
// between pockets or people and are kept so balances still add up.
export const KINDS = ['expense', 'income', 'inflow', 'refund', 'interest', 'transfer_out', 'loan_out'];

export const hashId = (...parts) => createHash('sha256').update(parts.join('␟')).digest('hex').slice(0, 16);
export const batchId = (source, text) => `${source}:${createHash('sha256').update(text).digest('hex').slice(0, 12)}`;

export function toCents(value) {
  let s = String(value).trim();
  if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`not an amount: ${JSON.stringify(value)}`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] ? -cents : cents;
}

export function fromCents(cents) {
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// Text cells that start like a formula are prefixed with ' so a spreadsheet shows them
// instead of running them (threat model AC1).
const FORMULA_START = /^[=+\-@\t\r]/;
const TEXT_FIELDS = new Set(['category', 'merchant', 'description_raw', 'source_ref', 'flags']);

function cell(field, value) {
  let s = value == null ? '' : String(value);
  if (TEXT_FIELDS.has(field) && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(transactions) {
  const lines = [FIELDS.join(',')];
  for (const t of transactions) {
    const row = { ...t, amount: fromCents(t.amount), flags: (t.flags ?? []).join('|') };
    lines.push(FIELDS.map((f) => cell(f, row[f])).join(','));
  }
  return `${lines.join('\n')}\n`;
}
