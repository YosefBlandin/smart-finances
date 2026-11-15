// The probe against a fake Payments API. Names and ids are made up; the test checks none are printed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { keyPaths, probe, summarize } from './mercadopago-probe.mjs';
import { D19_COLUMNS, REPORT_COLUMNS } from './mercadopago-sync.mjs';

const HEADER = 'DATE;SOURCE_ID;DESCRIPTION;NET_CREDIT_AMOUNT;NET_DEBIT_AMOUNT;GROSS_AMOUNT;MP_FEE_AMOUNT;TAXES_AMOUNT;PAYMENT_METHOD;TRANSACTION_APPROVAL_DATE;BUSINESS_UNIT;SUB_UNIT;BALANCE_AMOUNT;PAYMENT_METHOD_TYPE;PURCHASE_ID';
const row = (date, id, desc, credit, debit, balance) =>
  [date, id, desc, credit, debit, '0.00', '0.00', '0.00', 'available_money', date, '', '', balance, '', ''].join(';');
const report = [
  HEADER,
  row('2026-10-01T00:00:00.000-03:00', '', '', '1000.00', '0.00', '1000.00'),
  row('2026-10-02T10:00:00.000-03:00', '901', 'payment', '0.00', '100.00', '900.00'), // paid a shop
  row('2026-10-03T10:00:00.000-03:00', '902', 'payment', '50.00', '0.00', '950.00'), // money received
  row('2026-10-04T10:00:00.000-03:00', '903', 'payout', '0.00', '200.00', '750.00'), // sent to someone
  ';;;750.00;0.00;0.00;0.00;0.00;;;;;0.00;;',
].join('\n');

const SHOP = { id: 901, operation_type: 'regular_payment', description: 'TEST-SHOP-ITEM', collector: { nickname: 'TEST-SHOP' }, payer: { email: 'test@example.com' }, point_of_interaction: { transaction_data: { commerce: { name: 'TEST-COMMERCE', mcc: '5812' }, bank_info: { collector: { long_name: 'TEST-HOLDER' } } } } };
const RECEIVED = { id: 902, operation_type: 'money_transfer', payer: { first_name: 'TEST-PERSON' } };

function fakeApi() {
  const calls = [];
  return {
    calls,
    async get(p) {
      calls.push(p);
      if (p === '/users/me') return { status: 200, data: { id: 4242 }, text: '' };
      if (p.startsWith('/v1/payments/search')) {
        const results = p.includes('payer.id=4242') ? [SHOP] : p.includes('collector.id=4242') ? [RECEIVED] : [];
        return { status: 200, data: { paging: { total: results.length }, results }, text: '' };
      }
      return { status: 404, data: null, text: '{"message":"not found"}' };
    },
  };
}

test('the probe matches searches to report operations and prints no personal values', async () => {
  const api = fakeApi();
  const lines = [];
  const result = await probe({ api, files: [{ name: 'release-2026-10.csv', text: report }], ym: '2026-10', log: (l) => lines.push(l) });
  const out = lines.join('\n');
  assert.equal(result.found, 2);
  assert.equal(result.operations, 3);
  assert.match(out, /you as payer: 1 payments read; report operations matched: expense 1\/1/);
  assert.match(out, /you as collector: .*inflow 1\/1/);
  assert.match(out, /expense \/ regular_payment: 1, 1 different descriptions/);
  assert.match(out, /filled: collector\.nickname 1, description 1, payer\.email 1, point_of_interaction\.transaction_data\.bank_info\.collector\.long_name 1, point_of_interaction\.transaction_data\.commerce\.mcc 1, point_of_interaction\.transaction_data\.commerce\.name 1/);
  assert.match(out, /mcc=5812 1/);
  assert.match(out, /inflow \/ money_transfer: 1/);
  assert.match(out, /transfer_out: HTTP 404/);
  for (const secret of ['TEST-SHOP', 'TEST-PERSON', 'TEST-COMMERCE', 'TEST-HOLDER', 'test@example.com', '4242', '901', '902', '903']) {
    assert.ok(!out.includes(secret), `output must not include ${secret}`);
  }
  assert.ok(api.calls.some((c) => c.includes('payer.id=4242') && c.includes('limit=50')));
});

test('summarize groups by kind and operation type and folds odd values', () => {
  const s = summarize([{ id: 1, operation_type: 'Weird Value!', status: 'approved', description: 'x' }], new Map([['1', 'expense']]));
  assert.equal(s['expense / other'].count, 1);
  assert.deepEqual(s['expense / other'].fields, { description: 1 });
  assert.deepEqual(s['expense / other'].enums, { 'status=approved': 1 });
  assert.deepEqual([...keyPaths({ a: { b: [{ c: 'x' }] }, d: '' })].sort(), ['a', 'a.b', 'a.b[].c']);
});

test('T-ENR-19 the config default is the 15 live columns plus the payer name and payout account columns', () => {
  assert.deepEqual(REPORT_COLUMNS, [
    'DATE', 'SOURCE_ID', 'DESCRIPTION', 'NET_CREDIT_AMOUNT', 'NET_DEBIT_AMOUNT', 'GROSS_AMOUNT', 'MP_FEE_AMOUNT', 'TAXES_AMOUNT',
    'PAYMENT_METHOD', 'TRANSACTION_APPROVAL_DATE', 'BUSINESS_UNIT', 'SUB_UNIT', 'BALANCE_AMOUNT', 'PAYMENT_METHOD_TYPE', 'PURCHASE_ID',
    'PAYER_NAME', 'PAYOUT_BANK_ACCOUNT_NUMBER',
  ]);
  assert.deepEqual(D19_COLUMNS, ['PAYER_NAME', 'PAYOUT_BANK_ACCOUNT_NUMBER']);
  // mercadopago-report.mjs reads the token when imported, so its config command is checked by its source.
  const cli = readFileSync(new URL('./mercadopago-report.mjs', import.meta.url), 'utf8');
  assert.match(cli, /columns: REPORT_COLUMNS\.map\(\(key\) => \(\{ key \}\)\)/);
  assert.match(cli, /import \{[^}]*REPORT_COLUMNS[^}]*\} from '\.\/mercadopago-sync\.mjs'/);
});

test('T-ENR-19 probe error lines carry the code and HTTP status only, never a response body', async () => {
  const body = '{"message":"secret detail TEST-PERSON"}';
  const api = {
    async get(p) {
      if (p === '/users/me') return { status: 200, data: { id: 4242 }, text: '' };
      return { status: 500, data: JSON.parse(body), text: body };
    },
  };
  const lines = [];
  await probe({ api, files: [{ name: 'release-2026-10.csv', text: report }], ym: '2026-10', log: (l) => lines.push(l) });
  const out = lines.join('\n');
  assert.match(out, /search: failed: search_failed, HTTP 500/);
  assert.match(out, /expense: HTTP 500/);
  assert.ok(!out.includes('secret') && !out.includes('TEST-PERSON'));

  const refused = { get: async () => ({ status: 401, data: null, text: 'TEST-BODY' }) };
  await assert.rejects(probe({ api: refused, files: [{ name: 'release-2026-10.csv', text: report }], ym: '2026-10', log: () => {} }), (e) => !e.message.includes('TEST-BODY'));
});
