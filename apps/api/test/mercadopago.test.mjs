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
