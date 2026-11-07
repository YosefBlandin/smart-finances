// The one table every importer writes into. Amounts are integer cents in memory and fixed
// two-decimal strings on disk, so no float ever touches money.
import { createHash } from 'node:crypto';
import { FIELDS, KINDS } from '@smart-finances/contracts/fields';

// The field list and the kinds live in the shared contracts package so the web app can use them too.
export { FIELDS, KINDS };

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
