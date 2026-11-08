// The second-account test (AC-2, AC-3, D-6): person B calls every route against a store holding
// person A's data, and sees and changes none of it. Files are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES } from '@smart-finances/contracts/routes';
import { FIELDS } from '@smart-finances/contracts/fields';
import { createMemoryStore } from '../src/store/memory.mjs';
import { createUlid } from '../src/store/ulid.mjs';
import { createDeleteHandler } from '../src/handlers/delete.mjs';
import { createParserHandler, objectCreated } from '../src/handlers/parser.mjs';
import { createReadHandler } from '../src/handlers/read.mjs';
import { createRollupHandler } from '../src/handlers/rollup.mjs';
import { createWriteHandler } from '../src/handlers/write.mjs';
import { handler as health } from '../src/hello/index.mjs';
import { httpEvent } from './fixtures/http.mjs';

const A = 'person-a';
const B = 'person-b';
const T0 = Date.parse('2026-11-01T12:00:00.000Z');

const HEADER = 'DATE;SOURCE_ID;DESCRIPTION;NET_CREDIT_AMOUNT;NET_DEBIT_AMOUNT;GROSS_AMOUNT;MP_FEE_AMOUNT;TAXES_AMOUNT;PAYMENT_METHOD;TRANSACTION_APPROVAL_DATE;BUSINESS_UNIT;SUB_UNIT;BALANCE_AMOUNT;PAYMENT_METHOD_TYPE;PURCHASE_ID';
const mpRow = (date, id, desc, credit, debit, balance) => [date, id, desc, credit, debit, '0.00', '0.00', '0.00', 'available_money', date, '', '', balance, '', ''].join(';');
const REPORT = [
  HEADER,
  mpRow('2026-05-01T00:00:00.000-03:00', '', '', '1000.00', '0.00', '1000.00'),
  mpRow('2026-05-02T10:00:02.000-03:00', '111', 'payment', '0.00', '250.00', '750.00'),
  mpRow('2026-05-03T10:00:02.000-03:00', '112', 'payout', '0.00', '50.00', '700.00'),
  ';;;700.00;0.00;0.00;0.00;0.00;;;;;0.00;;',
].join('\n');

// Which function serves which route (architecture.md Components "API stack").
const SERVED_BY = {
  'GET /health': 'health',
  'POST /imports': 'write',
  'GET /imports': 'read',
  'GET /imports/{id}': 'read',
  'POST /imports/{id}/undo': 'write',
  'POST /periods/{source}/{period}/repair': 'write',
  'GET /transactions': 'read',
  'GET /totals': 'read',
  'GET /review': 'read',
  'PUT /transactions/{id}/review': 'write',
  'GET /rates': 'read',
  'PUT /rates/{month}': 'write',
  'POST /totals/rebuild': 'write',
  'GET /export': 'read',
  'DELETE /data': 'delete',
};

function world() {
  const store = createMemoryStore();
  const now = () => T0;
  const ulid = createUlid();
  const handlers = {
    health,
    read: createReadHandler({ store, now }),
    write: createWriteHandler({ store, now, ulid, parserFunction: 'parser-fn', rollupFunction: 'rollup-fn' }),
    delete: createDeleteHandler({ store, now }),
  };
  const parser = createParserHandler({ store, now });
  const rollup = createRollupHandler({ store, now });
  const call = async (sub, routeKey, opts) => {
    const res = await handlers[SERVED_BY[routeKey]](httpEvent(sub, routeKey, opts));
    const body = res.headers['content-type'].startsWith('application/json') ? JSON.parse(res.body) : res.body;
    return { status: res.statusCode, body };
  };
  return { store, call, parser, rollup };
}

test('T-AUTH-3 every one of the 15 routes is covered here', () => {
  assert.equal(Object.keys(ROUTES).length, 15);
  assert.deepEqual(Object.keys(SERVED_BY).sort(), Object.keys(ROUTES).sort());
});

test('T-AUTH-3 person B sees and changes none of person A\'s rows, imports, choices, rates, totals or files, on all 15 routes', async () => {
  const w = world();
  // Person A, seeded through the handlers: an import (write handler, then the parser on an
  // Object Created event), a review choice, a rate and the month's totals.
  const form = await w.call(A, 'POST /imports', { body: { source: 'mercadopago', file_name: 'may.csv', size: Buffer.byteLength(REPORT) } });
  assert.equal(form.status, 201);
  const key = form.body.upload.fields.key;
  w.store.putObject(key, REPORT);
  await w.parser(objectCreated(key, new Date(T0).toISOString()));
  const importId = form.body.import_id;
  const listed = await w.call(A, 'GET /transactions', { queryStringParameters: { from: '2026-05', to: '2026-05' } });
  assert.equal(listed.body.items.length, 2);
  const row = listed.body.items[0];
  assert.equal((await w.call(A, 'PUT /transactions/{id}/review', { pathParameters: { id: row.id }, body: { date: row.date, category: 'Groceries' } })).status, 200);
  assert.equal((await w.call(A, 'PUT /rates/{month}', { pathParameters: { month: '2026-05' }, body: { ars_per_usd: 1000 } })).status, 200);
  await w.rollup({ sub: A, months: 'all' });
  assert.equal((await w.call(A, 'GET /totals', { queryStringParameters: { from: '2026-05', to: '2026-05' } })).body.months.length, 1);

  const snapshot = () => JSON.stringify({ items: [...w.store.items.entries()].sort(), objects: [...w.store.objects.keys()].sort() });
  const before = snapshot();
  assert.ok(before.includes(`U#${A}`) && before.includes(`uploads/${A}/`));
  const seen = new Set();
  const asB = async (routeKey, opts) => {
    seen.add(routeKey);
    return w.call(B, routeKey, opts);
  };

  // Reads: empty, or not found.
  assert.equal((await asB('GET /health')).status, 200);
  assert.deepEqual((await asB('GET /imports')).body, { items: [] });
  assert.equal((await asB('GET /imports/{id}', { pathParameters: { id: importId } })).status, 404);
  assert.deepEqual((await asB('GET /transactions', { queryStringParameters: { from: '2026-01', to: '2026-12' } })).body, { items: [] });
  assert.deepEqual((await asB('GET /totals', { queryStringParameters: { from: '2026-01', to: '2026-12' } })).body, { months: [], missing_rates: [] });
  assert.deepEqual((await asB('GET /totals', { queryStringParameters: { from: '2026-01', to: '2026-12', view: 'usd' } })).body, { months: [], missing_rates: [] });
  assert.deepEqual((await asB('GET /review')).body, { items: [] });
  assert.deepEqual((await asB('GET /rates')).body, { items: [] });
  assert.equal((await asB('GET /export')).body, `${FIELDS.join(',')}\n`);

  // Writes aimed at A's things: not found, and nothing of A's changes.
  assert.equal((await asB('POST /imports/{id}/undo', { pathParameters: { id: importId } })).status, 404);
  assert.equal((await asB('PUT /transactions/{id}/review', { pathParameters: { id: row.id }, body: { date: row.date, approved: true } })).status, 404);
  assert.equal(snapshot(), before, 'nothing changed by the reads and refused writes');

  // Writes in B's own partition: they touch only B.
  const repair = await asB('POST /periods/{source}/{period}/repair', { pathParameters: { source: 'mercadopago', period: '2026-05' } });
  assert.ok([202, 404].includes(repair.status));
  assert.deepEqual((await asB('POST /totals/rebuild')).body, { months: 0 });
  assert.equal((await asB('PUT /rates/{month}', { pathParameters: { month: '2026-05' }, body: { ars_per_usd: 5 } })).status, 200);
  const bForm = await asB('POST /imports', { body: { source: 'csv', file_name: 'b.csv', size: 10 } });
  assert.equal(bForm.status, 201);
  assert.match(bForm.body.upload.fields.key, new RegExp(`^uploads/${B}/`));
  assert.deepEqual((await asB('GET /rates')).body, { items: [{ month: '2026-05', ars_per_usd: 5 }] });
  for (const { payload } of w.store.invocations) assert.equal(payload.sub, B, 'every async invoke is for B');

  // B's delete-all removes only B's items and files.
  w.store.putObject(bForm.body.upload.fields.key, 'x');
  const bErase = await asB('DELETE /data', { body: { confirm: 'DELETE' } });
  assert.ok([202, 409].includes(bErase.status));
  if (bErase.status === 409) {
    // B's own form is still open; once it expires the erase runs.
    const late = createDeleteHandler({ store: w.store, now: () => T0 + 16 * 60_000 });
    assert.equal((await late(httpEvent(B, 'DELETE /data', { body: { confirm: 'DELETE' } }))).statusCode, 202);
  }
  const after = JSON.parse(snapshot());
  assert.deepEqual(after.items.filter(([id]) => id.startsWith(`U#${B}`)).map(([, i]) => i.sk), ['ERASED']);
  assert.deepEqual(after.objects.filter((k) => k.startsWith(`uploads/${B}/`)), []);
  const onlyA = (s) => {
    const parsed = typeof s === 'string' ? JSON.parse(s) : s;
    return JSON.stringify({ items: parsed.items.filter(([id]) => id.startsWith(`U#${A}`)), objects: parsed.objects.filter((k) => k.startsWith(`uploads/${A}/`)) });
  };
  assert.equal(onlyA(after), onlyA(before), "A's items and files are untouched");

  assert.deepEqual([...seen].sort(), Object.keys(ROUTES).sort(), 'B called every route');
});

test('T-AUTH-3 no route reads a person from the path, query or body', async () => {
  const w = world();
  for (const routeKey of Object.keys(ROUTES).filter((r) => r !== 'GET /health')) {
    const res = await w.call(null, routeKey, {
      pathParameters: { id: 'x', source: 'csv', period: 'log', month: '2026-05', sub: A },
      queryStringParameters: { sub: A, from: '2026-05', to: '2026-05' },
      body: { sub: A, confirm: 'DELETE' },
    });
    assert.equal(res.status, 401, routeKey);
  }
});
