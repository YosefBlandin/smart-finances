// The write handler's import routes against the in-memory store. Files are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S3Client } from '@aws-sdk/client-s3';
import { ROUTES } from '@smart-finances/contracts/routes';
import { createMemoryStore } from '../src/store/memory.mjs';
import { createRepo } from '../src/store/repo.mjs';
import { createUlid } from '../src/store/ulid.mjs';
import { createWriteHandler } from '../src/handlers/write.mjs';

const A = 'person-a';
const T0 = Date.parse('2026-11-01T12:00:00.000Z');
const MiB = 1024 * 1024;

import { httpEvent } from './fixtures/http.mjs';

export { httpEvent };

function setup() {
  const store = createMemoryStore();
  const handler = createWriteHandler({ store, now: () => T0, ulid: createUlid(), parserFunction: 'parser-fn' });
  const post = async (body, sub = A) => {
    const res = await handler(httpEvent(sub, 'POST /imports', { body }));
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
  return { store, handler, post };
}

test('T-API-1 POST /imports refuses a bad source or file name with bad_request', async () => {
  const { store, post } = setup();
  for (const body of [
    { source: 'bank', file_name: 'a.csv', size: 10 },
    { source: 'mercadopago', file_name: 'a.md', size: 10 },
    { source: 'notion', file_name: 'a.csv', size: 10 },
    { source: 'excel', file_name: 'budget.xlsx', size: 10 },
    { source: 'excel', file_name: 'b_Foo_2026.xlsx', size: 10 },
    { source: 'csv', file_name: '../x.csv', size: 10 },
    { source: 'csv', file_name: 'a.csv', size: 0 },
    { source: 'csv', file_name: 'a.csv', size: 1.5 },
    { source: 'csv', file_name: 'a.csv' },
    'not json',
  ]) {
    const res = await post(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error.code, 'bad_request');
  }
  assert.equal(store.items.size, 0);
});

test('T-API-1 POST /imports refuses an over-cap size with too_large', async () => {
  const { store, post } = setup();
  const csv = await post({ source: 'csv', file_name: 'a.csv', size: 5 * MiB + 1 });
  assert.deepEqual([csv.status, csv.body.error.code], [413, 'too_large']);
  const excel = await post({ source: 'excel', file_name: 'b_Mar_2026.xlsx', size: 20 * MiB + 1 });
  assert.deepEqual([excel.status, excel.body.error.code], [413, 'too_large']);
  assert.equal(store.items.size, 0);
  assert.equal((await post({ source: 'excel', file_name: 'b_Mar_2026.xlsx', size: 20 * MiB })).status, 201);
});

test('T-API-1 POST /imports without a sign-in is unauthorized', async () => {
  const { store, post } = setup();
  const res = await post({ source: 'csv', file_name: 'a.csv', size: 10 }, null);
  assert.deepEqual([res.status, res.body.error.code], [401, 'unauthorized']);
  assert.equal(store.items.size, 0);
});

test('T-API-2 POST /imports answers 201 with a form for exactly uploads/<sub>/<importId> and a 15-minute expiry', async () => {
  const { store, post } = setup();
  const res = await post({ source: 'mercadopago', file_name: 'may.csv', size: 1234 });
  assert.equal(res.status, 201);
  assert.ok(ROUTES['POST /imports'].reply.safeParse(res.body).success, JSON.stringify(res.body));
  const { import_id, upload, expires_at } = res.body;
  assert.equal(upload.fields.key, `uploads/${A}/${import_id}`);
  assert.equal(upload.fields['x-max-bytes'], String(5 * MiB));
  assert.equal(upload.fields['x-expires-seconds'], '900');
  assert.equal(expires_at, new Date(T0 + 15 * 60_000).toISOString());
  const [record] = [...store.items.values()];
  assert.equal(record.pk, `U#${A}`);
  assert.equal(record.status, 'requested');
  assert.equal(record.s3_key, upload.fields.key);
  assert.equal(record.size, 1234);
});

test('T-API-2 the signed form allows one exact key, 1 byte to the cap, and expires in 15 minutes', async () => {
  const s3 = new S3Client({ region: 'us-east-1', credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'not-a-secret' } });
  const repo = createRepo({ s3, bucketName: 'bucket-example', tableName: 'table-example', ddb: {}, lambda: {} });
  const before = Date.now();
  const form = await repo.presignPost(`uploads/${A}/01ABC`, { maxBytes: 5 * MiB, expiresSeconds: 900 });
  const policy = JSON.parse(Buffer.from(form.fields.Policy, 'base64').toString('utf8'));
  assert.equal(form.fields.key, `uploads/${A}/01ABC`);
  assert.ok(policy.conditions.some((c) => c.key === `uploads/${A}/01ABC`), JSON.stringify(policy.conditions));
  assert.ok(!policy.conditions.some((c) => Array.isArray(c) && c[0] === 'starts-with'));
  assert.ok(policy.conditions.some((c) => Array.isArray(c) && c[0] === 'content-length-range' && c[1] === 1 && c[2] === 5 * MiB));
  const expires = Date.parse(policy.expiration) - before;
  assert.ok(expires > 899_000 && expires <= 901_000, String(expires));
});

// ---- SF-29: undo and repair ----
import { createParserHandler, objectCreated } from '../src/handlers/parser.mjs';
import { getImport, getPointer, LOCK_MS, takeLock } from '../src/store/imports.mjs';
import { PREFIX } from '../src/store/keys.mjs';

const MIN = 60_000;
const csvFile = (...rows) => ['date,description,amount,currency,account', ...rows.map((r, i) => `2026-03-0${i + 1},${r},-1.00,ARS,acc`)].join('\n');

function world() {
  const store = createMemoryStore();
  let clock = T0;
  const now = () => clock;
  const write = createWriteHandler({ store, now, ulid: createUlid(), parserFunction: 'parser-fn' });
  const parser = createParserHandler({ store, now });
  const call = async (routeKey, opts = {}) => {
    const res = await write(httpEvent(A, routeKey, opts));
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
  // Upload a file the way the browser does, then deliver its S3 event.
  async function importFile(source, file_name, text, { deliver = true } = {}) {
    const res = await call('POST /imports', { body: { source, file_name, size: Buffer.byteLength(text) } });
    assert.equal(res.status, 201);
    store.putObject(res.body.upload.fields.key, text);
    if (deliver) await parser(objectCreated(res.body.upload.fields.key, new Date(clock).toISOString()));
    return res.body.import_id;
  }
  // The parser's reconcile in process, in place of the async invoke.
  async function drain() {
    while (store.invocations.length) {
      const { functionName, payload } = store.invocations.shift();
      assert.equal(functionName, 'parser-fn');
      await parser(payload);
    }
  }
  const descriptions = () => [...store.items.values()].filter((i) => i.sk.startsWith(PREFIX.TXN)).map((i) => i.description_raw).sort();
  const tick = (ms) => { clock += ms; };
  return { store, call, importFile, drain, descriptions, tick, now };
}

test('T-REC-5 undo restores the previous file rows, then none; a repeat undo or a non-active import gets conflict', async () => {
  const w = world();
  const first = await w.importFile('csv', 'a.csv', csvFile('A', 'B'));
  w.tick(MIN);
  const second = await w.importFile('csv', 'a.csv', csvFile('A', 'C'));
  assert.deepEqual(w.descriptions(), ['A', 'C']);

  const undo = await w.call('POST /imports/{id}/undo', { pathParameters: { id: second } });
  assert.equal(undo.status, 202);
  assert.ok(ROUTES['POST /imports/{id}/undo'].reply.safeParse(undo.body).success);
  assert.notEqual(undo.body.import_id, second);
  const pending = await getImport(w.store, A, undo.body.import_id);
  assert.deepEqual([pending.kind, pending.status, pending.undo_of, pending.period_target], ['undo', 'reconciling', second, first]);
  await w.drain();
  assert.deepEqual(w.descriptions(), ['A', 'B']);
  assert.equal((await getImport(w.store, A, undo.body.import_id)).status, 'done');
  const p = await getPointer(w.store, A, 'csv', 'log');
  assert.deepEqual([p.active_import, p.history, p.lock_import], [first, [first], undefined]);

  const repeat = await w.call('POST /imports/{id}/undo', { pathParameters: { id: second } });
  assert.deepEqual([repeat.status, repeat.body.error.code], [409, 'conflict']);

  w.tick(MIN);
  const last = await w.call('POST /imports/{id}/undo', { pathParameters: { id: first } });
  assert.equal(last.status, 202);
  await w.drain();
  assert.deepEqual(w.descriptions(), []);
  assert.equal((await getPointer(w.store, A, 'csv', 'log')).active_import, undefined);
  assert.equal((await w.call('POST /imports/{id}/undo', { pathParameters: { id: first } })).status, 409);
  assert.equal((await w.call('POST /imports/{id}/undo', { pathParameters: { id: '01NOSUCH' } })).status, 404);
});

test('T-REC-5 undo is refused while the period is locked or during the erase window', async () => {
  const w = world();
  const id = await w.importFile('csv', 'a.csv', csvFile('A'));
  w.tick(MIN);
  const running = await w.importFile('csv', 'b.csv', csvFile('B'), { deliver: false });
  await takeLock(w.store, A, running, { period: 'log', now: w.now() });
  assert.equal((await w.call('POST /imports/{id}/undo', { pathParameters: { id } })).status, 409);
  w.tick(LOCK_MS + 1);
  await w.store.put({ pk: `U#${A}`, sk: 'ERASED', erased_at: new Date(w.now()).toISOString() });
  assert.equal((await w.call('POST /imports/{id}/undo', { pathParameters: { id } })).status, 409);
  assert.deepEqual(w.descriptions(), ['A']);
});

test('T-REC-6 repair finishes a stalled import', async () => {
  const w = world();
  await w.importFile('csv', 'a.csv', csvFile('A'));
  w.tick(MIN);
  const stalled = await w.importFile('csv', 'a.csv', csvFile('B', 'C'), { deliver: false });
  // Its run took the lock, committed, wrote one row and died.
  const realPut = w.store.put.bind(w.store);
  let puts = 0;
  w.store.put = async (item, opts) => {
    if (item.sk.startsWith(PREFIX.TXN) && ++puts === 2) throw new Error('crash');
    return realPut(item, opts);
  };
  const parser = createParserHandler({ store: w.store, now: w.now });
  await assert.rejects(parser(objectCreated(`uploads/${A}/${stalled}`, new Date(w.now()).toISOString())), /crash/);
  w.store.put = realPut;
  assert.equal((await w.call('POST /periods/{source}/{period}/repair', { pathParameters: { source: 'csv', period: 'log' } })).status, 409);
  w.tick(LOCK_MS + 1);
  const repair = await w.call('POST /periods/{source}/{period}/repair', { pathParameters: { source: 'csv', period: 'log' } });
  assert.equal(repair.status, 202);
  assert.ok(ROUTES['POST /periods/{source}/{period}/repair'].reply.safeParse(repair.body).success);
  await w.drain();
  assert.deepEqual(w.descriptions(), ['B', 'C']);
  assert.equal((await getImport(w.store, A, stalled)).status, 'done');
  assert.equal((await getImport(w.store, A, repair.body.import_id)).kind, 'repair');
  assert.equal((await getImport(w.store, A, repair.body.import_id)).status, 'done');
});

test('T-REC-6 repair overlapping an import is refused; a bad period or source is bad_request; no pointer is not_found', async () => {
  const w = world();
  const running = await w.importFile('csv', 'a.csv', csvFile('A'), { deliver: false });
  await takeLock(w.store, A, running, { period: 'log', now: w.now() });
  assert.equal((await w.call('POST /periods/{source}/{period}/repair', { pathParameters: { source: 'csv', period: 'log' } })).status, 409);
  assert.equal((await w.call('POST /periods/{source}/{period}/repair', { pathParameters: { source: 'csv', period: '2026-13' } })).status, 400);
  assert.equal((await w.call('POST /periods/{source}/{period}/repair', { pathParameters: { source: 'bank', period: 'log' } })).status, 400);
  assert.equal((await w.call('POST /periods/{source}/{period}/repair', { pathParameters: { source: 'mercadopago', period: '2026-05' } })).status, 404);
});

test('T-REC-6 a payments report correction that crashed with overlapping keys is fixed by repair', async () => {
  const w = world();
  const H = 'DATE;SOURCE_ID;DESCRIPTION;NET_CREDIT_AMOUNT;NET_DEBIT_AMOUNT;GROSS_AMOUNT;MP_FEE_AMOUNT;TAXES_AMOUNT;PAYMENT_METHOD;TRANSACTION_APPROVAL_DATE;BUSINESS_UNIT;SUB_UNIT;BALANCE_AMOUNT;PAYMENT_METHOD_TYPE;PURCHASE_ID';
  const r = (date, id, debit, balance) => [date, id, 'payment', '0.00', debit, '0.00', '0.00', '0.00', 'available_money', date, '', '', balance, '', ''].join(';');
  const report = (rows, end) => [H, r('2026-05-01T00:00:00.000-03:00', '', '0.00', '1000.00').replace(';payment;', ';;'), ...rows, `;;;${end};0.00;0.00;0.00;0.00;;;;;0.00;;`].join('\n');
  await w.importFile('mercadopago', 'may.csv', report([r('2026-05-02T10:00:00.000-03:00', '111', '100.00', '900.00'), r('2026-05-03T10:00:00.000-03:00', '222', '50.00', '850.00')], '850.00'));
  const before = w.descriptions().length;
  assert.equal(before, 2);
  w.tick(MIN);
  // The corrected report keeps 111 (same key), changes 222's day and adds 333; its run dies after one put.
  const fixed = report([r('2026-05-02T10:00:00.000-03:00', '111', '100.00', '900.00'), r('2026-05-04T10:00:00.000-03:00', '222', '50.00', '850.00'), r('2026-05-05T10:00:00.000-03:00', '333', '10.00', '840.00')], '840.00');
  const realPut = w.store.put.bind(w.store);
  let puts = 0;
  w.store.put = async (item, opts) => {
    if (item.sk.startsWith(PREFIX.TXN) && ++puts === 2) throw new Error('crash');
    return realPut(item, opts);
  };
  await assert.rejects(w.importFile('mercadopago', 'may-fixed.csv', fixed), /crash/);
  w.store.put = realPut;
  w.tick(LOCK_MS + 1);
  const repair = await w.call('POST /periods/{source}/{period}/repair', { pathParameters: { source: 'mercadopago', period: '2026-05' } });
  assert.equal(repair.status, 202);
  await w.drain();
  const rows = [...w.store.items.values()].filter((i) => i.sk.startsWith(PREFIX.TXN));
  assert.deepEqual(rows.map((i) => [i.source_ref.split('#')[1], i.date]).sort(), [['111', '2026-05-02'], ['222', '2026-05-04'], ['333', '2026-05-05']]);
});

// ---- SF-29 review fixes ----
test('T-REC-5 a reconcile that cannot be started fails its record and frees the period for a repair', async () => {
  const w = world();
  const first = await w.importFile('csv', 'a.csv', csvFile('A'));
  w.tick(MIN);
  const second = await w.importFile('csv', 'a.csv', csvFile('B'));
  const realInvoke = w.store.invokeAsync;
  w.store.invokeAsync = async () => { throw new Error('lambda down'); };
  const undo = await w.call('POST /imports/{id}/undo', { pathParameters: { id: second } });
  assert.equal(undo.status, 500);
  w.store.invokeAsync = realInvoke;
  const p = await getPointer(w.store, A, 'csv', 'log');
  assert.deepEqual([p.active_import, p.lock_import], [first, undefined]);
  const records = [...w.store.items.values()].filter((i) => i.kind === 'undo');
  assert.deepEqual(records.map((r) => [r.status, r.error.code]), [['failed', 'not_started']]);
  const repair = await w.call('POST /periods/{source}/{period}/repair', { pathParameters: { source: 'csv', period: 'log' } });
  assert.equal(repair.status, 202);
  await w.drain();
  assert.deepEqual(w.descriptions(), ['A']);
});

test('T-REC-5 undo of an import that never arrived, or of an undo record, gets conflict', async () => {
  const w = world();
  const pending = await w.importFile('csv', 'a.csv', csvFile('A'), { deliver: false });
  assert.equal((await w.call('POST /imports/{id}/undo', { pathParameters: { id: pending } })).status, 409);
  w.tick(MIN);
  const id = await w.importFile('csv', 'b.csv', csvFile('B'));
  const undo = await w.call('POST /imports/{id}/undo', { pathParameters: { id } });
  await w.drain();
  assert.equal((await w.call('POST /imports/{id}/undo', { pathParameters: { id: undo.body.import_id } })).status, 409);
});
