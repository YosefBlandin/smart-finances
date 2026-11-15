// Fixture is made up; it only copies the shape of a real release report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReleaseReport } from '../src/ingest/mercadopago.mjs';

const HEADER = 'DATE;SOURCE_ID;DESCRIPTION;NET_CREDIT_AMOUNT;NET_DEBIT_AMOUNT;GROSS_AMOUNT;MP_FEE_AMOUNT;TAXES_AMOUNT;PAYMENT_METHOD;TRANSACTION_APPROVAL_DATE;BUSINESS_UNIT;SUB_UNIT;BALANCE_AMOUNT;PAYMENT_METHOD_TYPE;PURCHASE_ID';
const row = (date, id, desc, credit, debit, balance, extra = {}) =>
  [date, id, desc, credit, debit, '0.00', '0.00', '0.00', extra.method ?? 'available_money', date, extra.bu ?? '', extra.sub ?? '', balance, '', ''].join(';');

const report = [
  HEADER,
  row('2026-05-01T00:00:00.000-03:00', '', '', '1000.00', '0.00', '1000.00'),
  // QR payment of 250: hold, release, then the payment itself
  row('2026-05-02T10:00:00.000-03:00', '111', 'reserve_for_payment', '0.00', '250.00', '750.00', { bu: 'Mercado Pago', sub: 'QR' }),
  row('2026-05-02T10:00:01.000-03:00', '111', 'reserve_for_payment', '250.00', '0.00', '1000.00'),
  row('2026-05-02T10:00:02.000-03:00', '111', 'payment', '0.00', '250.00', '750.00'),
  // money received
  row('2026-05-03T09:00:00.000-03:00', '222', 'payment', '500.00', '0.00', '1250.00', { method: 'cvu' }),
  // daily yield
  row('2026-05-04T00:00:00.000-03:00', '333', 'asset_management', '1.25', '0.00', '1251.25'),
  // payout to a bank account
  row('2026-05-05T12:00:00.000-03:00', '444', 'reserve_for_payout', '0.00', '100.00', '1151.25'),
  row('2026-05-05T12:00:01.000-03:00', '444', 'reserve_for_payout', '100.00', '0.00', '1251.25'),
  row('2026-05-05T12:00:02.000-03:00', '444', 'payout', '0.00', '100.00', '1151.25'),
  // spills into the next month because the API's end date is inclusive
  row('2026-06-01T08:00:00.000-03:00', '555', 'payment', '0.00', '51.25', '1100.00'),
  ';;;1100.00;0.00;0.00;0.00;0.00;;;;;0.00;;',
].join('\n');

test('nets each operation and drops the reserve holds', () => {
  const { transactions, check } = parseReleaseReport(report, { file: 'may.csv' });
  const byRef = Object.fromEntries(transactions.map((t) => [t.source_ref.split('#')[1], t]));
  assert.deepEqual(Object.keys(byRef).sort(), ['111', '222', '333', '444']);
  assert.equal(byRef['111'].amount, -25000);
  assert.equal(byRef['111'].kind, 'expense');
  assert.equal(byRef['111'].date, '2026-05-02');
  assert.equal(byRef['222'].kind, 'inflow');
  assert.ok(byRef['222'].flags.includes('needs_review'));
  assert.equal(byRef['333'].kind, 'interest');
  assert.equal(byRef['444'].kind, 'transfer_out');
  assert.equal(byRef['444'].amount, -10000);

  assert.equal(check.month, '2026-05');
  assert.equal(check.rowsOutsideMonth, 1);
  assert.equal(check.balanceBreaks, 0);
  assert.equal(check.closingMatches, true);
  assert.equal(check.monthNetMatches, true);
  assert.equal(check.monthEnd, 115125);
});

test('ids are stable across re-imports', () => {
  const a = parseReleaseReport(report, { file: 'a.csv' }).transactions.map((t) => t.id);
  const b = parseReleaseReport(report, { file: 'renamed.csv' }).transactions.map((t) => t.id);
  assert.deepEqual(a, b);
});

test('a broken running balance is reported, not hidden', () => {
  const tampered = report.replace(';1250.00;', ';1249.00;');
  const { check } = parseReleaseReport(tampered, { file: 'bad.csv' });
  assert.ok(check.balanceBreaks > 0);
});

test('rejects a file without the required columns', () => {
  assert.throws(() => parseReleaseReport('DATE;AMOUNT\n2026-05-01;1'), /missing columns/);
});

// ---- enrichment columns (SF-4). The fixture is made up: names, codes and keys are invented. ----
import { readFileSync } from 'node:fs';

const enriched = readFileSync(new URL('./fixtures/release-enriched.csv', import.meta.url), 'utf8');
const byRef = (transactions) => Object.fromEntries(transactions.map((t) => [t.source_ref.split('#')[1], t]));

test('T-ENR-4 an enriched report gives each operation its merchant, recipient key and category; money received shows the sender name', () => {
  const { transactions, check } = parseReleaseReport(enriched, { file: 'release-2026-05.csv' });
  const t = byRef(transactions);
  assert.equal(check.closingMatches, true);
  assert.equal(check.monthNetMatches, true);
  // the first non-empty value of the operation's rows counts
  assert.deepEqual([t['111'].merchant, t['111'].recipient_key, t['111'].category], ['Made-up Cafe', 'a'.repeat(32), 'Dining out']);
  // money received: the sender's name from the report
  assert.equal(t['222'].kind, 'inflow');
  assert.deepEqual([t['222'].merchant, t['222'].recipient_key, t['222'].category], ['Ana Example', 'b'.repeat(32), 'Uncategorized']);
  // a payout: no name, only its key; transfers keep their category
  assert.deepEqual([t['444'].kind, t['444'].merchant, t['444'].recipient_key, t['444'].category], ['transfer_out', '', 'c'.repeat(32), 'Uncategorized']);
  // interest keeps its category and has no enrichment
  assert.deepEqual([t['333'].category, t['333'].merchant, t['333'].recipient_key], ['Interest', '', '']);
  // no code: the merchant name rule decides
  assert.equal(t['666'].category, 'Subscriptions & software');
  // no enrichment: the Mercado Libre rule still applies
  assert.deepEqual([t['888'].category, t['888'].merchant], ['Shopping', '']);
  assert.equal(t['777'].category, 'Uncategorized');
});

test('T-ENR-5 an enriched expense still Uncategorized gets needs_review; a categorized one does not', () => {
  const t = byRef(parseReleaseReport(enriched, { file: 'release-2026-05.csv' }).transactions);
  assert.deepEqual(t['777'].flags, ['needs_review']);
  for (const ref of ['111', '666', '888', '999']) assert.deepEqual(t[ref].flags, [], ref);
  // payouts and money received keep their own review flag, once
  assert.deepEqual(t['222'].flags, ['needs_review']);
  assert.deepEqual(t['444'].flags, ['needs_review']);
});

test('T-ENR-6 a file without SF_ columns parses as before', () => {
  const t = byRef(parseReleaseReport(report, { file: 'may.csv' }).transactions);
  for (const x of Object.values(t)) assert.deepEqual([x.merchant, x.recipient_key], ['', '']);
  assert.deepEqual(Object.values(t).map((x) => [x.kind, x.category, x.flags]), [
    ['expense', 'Uncategorized', []], // no enrichment: no review flag for the purchase, as before
    ['inflow', 'Uncategorized', ['needs_review']],
    ['interest', 'Interest', []],
    ['transfer_out', 'Uncategorized', ['needs_review']],
  ]);
});

test('T-ENR-6 a file without SUB_UNIT parses, and a cleaned value with spaces where ";" was imports', () => {
  const dropSubUnit = (text) => text.split('\n').map((l) => l.split(';').filter((_, i) => i !== 11).join(';')).join('\n');
  assert.equal(dropSubUnit(report).split('\n')[0].includes('SUB_UNIT'), false);
  const plain = parseReleaseReport(report, { file: 'may.csv' }).transactions;
  const noSub = parseReleaseReport(dropSubUnit(report), { file: 'may.csv' }).transactions;
  // import_batch hashes the file text and description_raw names the sub unit; everything else is unchanged
  const same = ({ description_raw: _d, import_batch: _b, ...x }) => x;
  assert.deepEqual(noSub.map(same), plain.map(same));
  assert.equal(byRef(noSub)['111'].description_raw, 'reserve_for_payment+payment / Mercado Pago / available_money');
  const t = byRef(parseReleaseReport(dropSubUnit(enriched), { file: 'release-2026-05.csv' }).transactions);
  assert.deepEqual([t['999'].merchant, t['999'].category], ['Kiosco El Sol Sur', 'Groceries']);
});

test('T-ENR-6 enrichment values of the wrong shape are left out', () => {
  const bad = enriched.replace('Made-up Shop;0000;eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'Made-up Shop;58120;NOT-A-KEY');
  const t = byRef(parseReleaseReport(bad, { file: 'release-2026-05.csv' }).transactions);
  assert.deepEqual([t['777'].recipient_key, t['777'].category], ['', 'Uncategorized']);
});
