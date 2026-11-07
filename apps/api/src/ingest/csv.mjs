// Generic CSV importer (D-23): reads the synthetic data shape (date, description, amount,
// currency, account), so evals and the demo use the same upload path as real files.
// Dates are ISO (YYYY-MM-DD) or day-first (DD/MM/YYYY). A file covers the period log.
import { CATEGORIES } from '@smart-finances/contracts/categories';
import { batchId, hashId, toCents } from './schema.mjs';

const COLUMNS = ['date', 'description', 'amount', 'currency', 'account'];
const UNCATEGORIZED = CATEGORIES.at(-1); // the fallback category (D-39)

// RFC 4180 records: quoted fields may hold commas, doubled quotes and line breaks.
function records(text) {
  const out = [];
  let row = [];
  let field = '';
  let quoted = false;
  let line = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      line += c;
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        line += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
      line += c;
    } else if (c === ',') {
      row.push(field);
      field = '';
      line += c;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      out.push({ cells: row, line });
      row = [];
      field = '';
      line = '';
    } else {
      field += c;
      line += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    out.push({ cells: row, line });
  }
  return out.filter((r) => !(r.cells.length === 1 && r.cells[0].trim() === ''));
}

function isoDate(raw) {
  const s = raw.trim();
  let y;
  let m;
  let d;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (match) [, y, m, d] = match;
  else if ((match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s))) [, d, m, y] = match;
  else return undefined;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) return undefined;
  return `${y}-${m}-${d}`;
}

export function parseGenericCsv(text, { file = 'upload.csv' } = {}) {
  const rows = records(String(text).replace(/^﻿/, ''));
  const header = rows[0]?.cells.map((c) => c.trim().toLowerCase());
  if (!header || !COLUMNS.every((c) => header.includes(c))) throw new Error(`csv header must name ${COLUMNS.join(', ')}`);
  const at = Object.fromEntries(COLUMNS.map((c) => [c, header.indexOf(c)]));
  const import_batch = batchId('csv', text);

  const transactions = [];
  const issues = [];
  const seen = new Set();
  rows.slice(1).forEach(({ cells, line }, index) => {
    const ref = `${file}#row ${index + 1}`;
    const skip = (issue) => issues.push({ ref, line, issue });
    if (cells.length !== header.length) return skip(`expected ${header.length} columns, found ${cells.length}`);
    const value = (c) => cells[at[c]];
    const date = isoDate(value('date'));
    if (!date) return skip('date is not YYYY-MM-DD or DD/MM/YYYY');
    let amount;
    try {
      amount = toCents(value('amount'));
    } catch {
      return skip('amount is not a number with at most two decimals');
    }
    const currency = value('currency').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return skip('currency is not a three-letter code');
    const description = value('description');
    const account = value('account');
    const id = hashId('csv', date, description, String(amount), currency, account);
    if (seen.has(id)) return void issues.push({ ref, line, issue: 'same row as an earlier one, kept once', info: true });
    seen.add(id);
    transactions.push({
      id,
      date,
      date_precision: 'day',
      kind: amount < 0 ? 'expense' : 'income',
      amount,
      currency,
      category: UNCATEGORIZED,
      merchant: '',
      description_raw: description,
      source: 'csv',
      source_ref: ref,
      country: '',
      flags: [],
      import_batch,
    });
  });
  return { transactions, issues };
}
