// Mercado Pago "released money" report (v1/account/release_report), CSV with ';'.
//
// Shape, as checked against the Aug and Sep 2026 account statements:
// - the first row has no DESCRIPTION and holds the opening balance of the requested range
// - the last row has no DATE and holds the closing balance in NET_CREDIT_AMOUNT
// - one operation (SOURCE_ID) spans several rows: a payment comes with reserve_for_payment
//   rows that hold and release the money. Only the net per SOURCE_ID is a real movement,
//   and those nets match the statement line for line.
// The report is assigned to the month of its opening row; rows outside that month are left
// out (the API treats the end date as inclusive, so a range can spill into the next day).
// Sync adds three columns per operation (SF_MERCHANT, SF_CATEGORY_CODE, SF_RECIPIENT; ADR 0010): the merchant or
// sender name, the payments service's category code and a keyed hash of the other party. A file without them
// imports exactly as before.
import { CATEGORIES } from '@smart-finances/contracts/categories';
import { merchantCategory } from './merchants.mjs';
import { batchId, hashId, toCents } from './schema.mjs';

const REQUIRED = ['DATE', 'SOURCE_ID', 'DESCRIPTION', 'NET_CREDIT_AMOUNT', 'NET_DEBIT_AMOUNT', 'BALANCE_AMOUNT'];
// The row type that decides what an operation is, strongest first.
const PRIORITY = ['payout', 'refund', 'payment', 'tip', 'asset_management', 'reserve_for_payout', 'reserve_for_payment'];
const ENRICHMENT = ['SF_MERCHANT', 'SF_CATEGORY_CODE', 'SF_RECIPIENT'];
// A value of the wrong shape is left out, so a hand-edited file cannot store a key no label can match.
const SHAPES = { SF_CATEGORY_CODE: /^\d{4}$/, SF_RECIPIENT: /^[0-9a-f]{32}$/ };
const UNCATEGORIZED = CATEGORIES.at(-1);
// Raw columns sync reads and then drops (D-19, D-21): a report that still holds one is refused as a whole,
// so names and account numbers reach the server only through sync's cleaned file.
export const PRIVATE_COLUMNS = ['PAYER_NAME', 'PAYOUT_BANK_ACCOUNT_NUMBER'];

// Thrown when the header holds a private column. The message names the column and the file, never a value.
export class PrivateColumns extends Error {
  constructor(column, file) {
    super(`${file ? `${file}: ` : ''}the release report holds the ${column} column; save the month with sync (npm run mp:sync), which removes it`);
    this.name = 'PrivateColumns';
    this.code = 'private_columns';
  }
}

function parseRows(text, file) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.length > 0);
  // Before any row is read, so no value of a private column is ever looked at (D-21).
  const header = (lines[0] ?? '').split(';').map((c) => c.trim());
  // A quoted header cell still counts, so a hand-saved report with quotes is refused here, not as unreadable.
  const names = header.map((c) => c.replace(/^"(.*)"$/, '$1').trim());
  const privateColumn = PRIVATE_COLUMNS.find((c) => names.includes(c));
  if (privateColumn) throw new PrivateColumns(privateColumn, file);
  if (lines.some((l) => l.includes('"'))) throw new Error('quoted CSV fields are not supported in the release report');
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`release report is missing columns: ${missing.join(', ')}`);
  return { header, rows: lines.slice(1).map((l) => Object.fromEntries(l.split(';').map((v, i) => [header[i], v.trim()]))) };
}

// The first non-empty value of a column over an operation's rows, if it has the column's shape; else ''.
function firstOf(group, column) {
  const value = group.map((r) => r[column] ?? '').find((v) => v !== '') ?? '';
  return !SHAPES[column] || SHAPES[column].test(value) ? value : '';
}

const net = (r) => toCents(r.NET_CREDIT_AMOUNT) - toCents(r.NET_DEBIT_AMOUNT);

// enriched: the file has the enrichment columns, so an expense left Uncategorized waits on the review list (D-6).
function classify(types, cents, { enriched = false, category } = {}) {
  const main = PRIORITY.find((t) => types.has(t)) ?? [...types][0];
  const flags = [];
  let kind;
  if (main === 'payout') {
    // Money sent out of the account: to your own bank or to a person (rent, for example).
    kind = 'transfer_out';
    flags.push('needs_review');
  } else if (main === 'asset_management') kind = 'interest';
  else if (main === 'refund') kind = cents > 0 ? 'refund' : 'expense';
  else if (main === 'payment' || main === 'tip') kind = cents < 0 ? 'expense' : 'inflow';
  else {
    kind = cents < 0 ? 'expense' : 'inflow';
    flags.push('reserve_only');
  }
  if (kind === 'inflow') flags.push('needs_review'); // a transfer from yourself or money received
  if (enriched && kind === 'expense' && category?.(kind) === UNCATEGORIZED) flags.push('needs_review');
  return { main, kind, flags };
}

// Expenses: the category code, then the merchant name (merchants.mjs), then the Mercado Libre rule (D-15).
function categoryFor(kind, rows, { code = '', merchant = '' } = {}) {
  if (kind === 'interest') return 'Interest';
  if (kind === 'refund') return 'Refunds';
  if (kind !== 'expense') return UNCATEGORIZED;
  const known = merchantCategory({ code, merchant });
  if (known) return known;
  if (rows.some((r) => r.BUSINESS_UNIT === 'Mercado Libre')) return 'Shopping';
  return UNCATEGORIZED;
}

export function parseReleaseReport(text, { file, currency = 'ARS', country = 'AR' } = {}) {
  const { header, rows } = parseRows(text, file);
  const enriched = ENRICHMENT.some((c) => header.includes(c));
  const opening = rows[0];
  const totals = rows.at(-1);
  if (opening?.DESCRIPTION || !opening?.DATE) throw new Error(`${file}: first row is not the opening balance`);
  if (totals?.DATE) throw new Error(`${file}: last row is not the totals row`);
  const body = rows.slice(1, -1);
  const month = opening.DATE.slice(0, 7);
  const import_batch = batchId('mercadopago', text);

  // Running balance and closing balance over the whole file, before any filtering.
  let balance = toCents(opening.BALANCE_AMOUNT);
  let balanceBreaks = 0;
  for (const r of body) {
    balance += net(r);
    if (balance !== toCents(r.BALANCE_AMOUNT)) balanceBreaks += 1;
  }
  const closing = toCents(totals.NET_CREDIT_AMOUNT);

  const inMonth = body.filter((r) => r.DATE.slice(0, 7) === month);
  const groups = new Map();
  for (const r of inMonth) {
    const key = r.SOURCE_ID || `row-${body.indexOf(r)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const transactions = [];
  let zeroNet = 0;
  for (const [sourceId, group] of groups) {
    const cents = group.reduce((s, r) => s + net(r), 0);
    if (cents === 0) {
      zeroNet += 1;
      continue;
    }
    const types = new Set(group.map((r) => r.DESCRIPTION));
    const merchant = firstOf(group, 'SF_MERCHANT');
    const code = firstOf(group, 'SF_CATEGORY_CODE');
    const category = (k) => categoryFor(k, group, { code, merchant });
    const { main, kind, flags } = classify(types, cents, { enriched, category });
    const dated = group.find((r) => r.DESCRIPTION === main) ?? group[0];
    // SUB_UNIT is optional: a report configured without it still imports.
    const unit = group.find((r) => r.BUSINESS_UNIT || (r.SUB_UNIT ?? '').trim()) ?? {};
    transactions.push({
      id: hashId('mercadopago', sourceId, month),
      date: dated.DATE.slice(0, 10),
      date_precision: 'day',
      kind,
      amount: cents,
      currency,
      category: category(kind),
      merchant,
      recipient_key: firstOf(group, 'SF_RECIPIENT'),
      description_raw: [[...types].join('+'), unit.BUSINESS_UNIT, unit.SUB_UNIT?.trim(), dated.PAYMENT_METHOD]
        .filter(Boolean)
        .join(' / '),
      source: 'mercadopago',
      source_ref: `${file ?? 'release report'}#${sourceId}`,
      country,
      flags,
      import_batch,
    });
  }

  const monthEnd = inMonth.length ? toCents(inMonth.at(-1).BALANCE_AMOUNT) : toCents(opening.BALANCE_AMOUNT);
  return {
    transactions,
    check: {
      file,
      month,
      rows: body.length,
      rowsOutsideMonth: body.length - inMonth.length,
      operations: groups.size,
      zeroNetOperations: zeroNet,
      opening: toCents(opening.BALANCE_AMOUNT),
      monthEnd,
      closing,
      balanceBreaks,
      // opening + every movement in the file must land on the printed closing balance
      closingMatches: balance === closing,
      // and the kept transactions alone must explain the month's change in balance
      monthNetMatches: transactions.reduce((s, t) => s + t.amount, 0) === monthEnd - toCents(opening.BALANCE_AMOUNT),
    },
  };
}
