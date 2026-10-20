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
import { batchId, hashId, toCents } from './schema.mjs';

const REQUIRED = ['DATE', 'SOURCE_ID', 'DESCRIPTION', 'NET_CREDIT_AMOUNT', 'NET_DEBIT_AMOUNT', 'BALANCE_AMOUNT'];
// The row type that decides what an operation is, strongest first.
const PRIORITY = ['payout', 'refund', 'payment', 'tip', 'asset_management', 'reserve_for_payout', 'reserve_for_payment'];

function parseRows(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.some((l) => l.includes('"'))) throw new Error('quoted CSV fields are not supported in the release report');
  const header = lines[0].split(';');
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`release report is missing columns: ${missing.join(', ')}`);
  return lines.slice(1).map((l) => Object.fromEntries(l.split(';').map((v, i) => [header[i], v.trim()])));
}

const net = (r) => toCents(r.NET_CREDIT_AMOUNT) - toCents(r.NET_DEBIT_AMOUNT);

function classify(types, cents) {
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
  return { main, kind, flags };
}

function categoryFor(kind, rows) {
  if (kind === 'interest') return 'Interest';
  if (kind === 'refund') return 'Refunds';
  if (kind === 'expense' && rows.some((r) => r.BUSINESS_UNIT === 'Mercado Libre')) return 'Shopping';
  return 'Uncategorized';
}

export function parseReleaseReport(text, { file, currency = 'ARS', country = 'AR' } = {}) {
  const rows = parseRows(text);
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
    const { main, kind, flags } = classify(types, cents);
    const dated = group.find((r) => r.DESCRIPTION === main) ?? group[0];
    const unit = group.find((r) => r.BUSINESS_UNIT || r.SUB_UNIT.trim()) ?? {};
    transactions.push({
      id: hashId('mercadopago', sourceId, month),
      date: dated.DATE.slice(0, 10),
      date_precision: 'day',
      kind,
      amount: cents,
      currency,
      category: categoryFor(kind, group),
      merchant: '',
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
