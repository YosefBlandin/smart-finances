// The rollup handler (stream batches and rebuild) and POST /totals/rebuild, against the in-memory
// store. Rows are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES } from '@smart-finances/contracts/routes';
import { createMemoryStore } from '../src/store/memory.mjs';
import { erasedKey, ovrKey, sumKey, txnKey } from '../src/store/keys.mjs';
import { createRollupHandler } from '../src/handlers/rollup.mjs';
import { createWriteHandler } from '../src/handlers/write.mjs';
import { httpEvent } from './fixtures/http.mjs';

const A = 'person-a';
const B = 'person-b';
const T0 = Date.parse('2026-11-01T12:00:00.000Z');

let n = 0;
const row = (date, amount, over = {}) => {
  n += 1;
  return {
    id: n.toString(16).padStart(16, '0'),
    date,
    date_precision: 'day',
    kind: 'expense',
    amount,
    currency: 'ARS',
    category: 'Groceries',
    merchant: '',
    description_raw: 'made-up',
    source: 'mercadopago',
    source_ref: `r${n}`,
    country: 'AR',
    flags: [],
    import_batch: 'b',
    ...over,
  };
};
const putRow = (store, sub, t) => store.put({ ...txnKey(sub, t.date, t.id), ...t, period: t.date.slice(0, 7), import_id: 'imp' });
const record = (pk, sk, eventName = 'INSERT') => ({ eventName, eventSource: 'aws:dynamodb', dynamodb: { Keys: { pk: { S: pk }, sk: { S: sk } } } });

function setup() {
  const store = createMemoryStore();
  let clock = T0;
  const now = () => (clock += 1);
  const rollup = createRollupHandler({ store, now });
  return { store, rollup, now };
}

test('T-ROL-3 a stream batch recomputes each touched person and month once; delivered twice it leaves totals unchanged', async () => {
  const { store, rollup } = setup();
  const may1 = row('2026-05-03', -100);
  const may2 = row('2026-05-20', -200);
  const jun = row('2026-06-01', -50);
  const theirs = row('2026-05-03', -999);
  for (const t of [may1, may2, jun]) await putRow(store, A, t);
  await putRow(store, B, theirs);
  await store.put({ ...ovrKey(A, may2.date, may2.id), date: may2.date, month: '2026-05', category: 'Dining out', approved: false, updated_at: 'x' });

  let calls = 0;
  const realQuery = store.query.bind(store);
  store.query = async (q) => {
    if (q.between?.[0].startsWith('TXN#')) calls += 1;
    return realQuery(q);
  };
  const batch = {
    Records: [
      record(`U#${A}`, `TXN#${may1.date}#${may1.id}`),
      record(`U#${A}`, `TXN#${may2.date}#${may2.id}`, 'MODIFY'),
      record(`U#${A}`, `OVR#${may2.date}#${may2.id}`),
      record(`U#${A}`, `TXN#${jun.date}#${jun.id}`),
      record(`U#${B}`, `TXN#${theirs.date}#${theirs.id}`),
      record(`U#${A}`, 'IMP#01ABC'),
      record(`U#${A}`, 'PER#mercadopago#2026-05'),
      record(`U#${A}`, 'SUM#2026-05'),
      record(`U#${A}`, 'ERASED'),
    ],
  };
  await rollup(batch);
  assert.equal(calls, 3, 'A in May, A in June, B in May; other keys are ignored');
  const may = await store.get(sumKey(A, '2026-05'));
  assert.deepEqual(may.totals, { expense: { Groceries: { ARS: -100 }, 'Dining out': { ARS: -200 } } });
  assert.deepEqual((await store.get(sumKey(A, '2026-06'))).totals, { expense: { Groceries: { ARS: -50 } } });
  assert.deepEqual((await store.get(sumKey(B, '2026-05'))).totals, { expense: { Groceries: { ARS: -999 } } });

  await rollup(batch);
  assert.deepEqual((await store.get(sumKey(A, '2026-05'))).totals, may.totals);
  assert.deepEqual((await store.get(sumKey(A, '2026-05'))).row_count, 2);
});

test('T-ROL-3 a removed row recomputes its month; an unexpected error fails the batch so it is retried', async () => {
  const { store, rollup } = setup();
  const t = row('2026-05-03', -100);
  await putRow(store, A, t);
  await rollup({ Records: [record(`U#${A}`, `TXN#${t.date}#${t.id}`)] });
  await store.remove(txnKey(A, t.date, t.id));
  await rollup({ Records: [record(`U#${A}`, `TXN#${t.date}#${t.id}`, 'REMOVE')] });
  assert.equal((await store.get(sumKey(A, '2026-05'))).row_count, 0);

  store.transact = async () => {
    throw new Error('throttled');
  };
  await assert.rejects(rollup({ Records: [record(`U#${A}`, `TXN#${t.date}#${t.id}`)] }), /throttled/);
  // An erase in progress is not an error: the batch completes and writes nothing.
  const fresh = setup();
  await putRow(fresh.store, A, t);
  await fresh.store.put({ ...erasedKey(A), erased_at: new Date(T0).toISOString() });
  await fresh.rollup({ Records: [record(`U#${A}`, `TXN#${t.date}#${t.id}`)] });
  assert.equal(await fresh.store.get(sumKey(A, '2026-05')), undefined);
});

test('T-ROL-4 rebuild recomputes every month with a TXN or SUM item and returns their count', async () => {
  const { store, rollup } = setup();
  await putRow(store, A, row('2026-03-01', -1));
  await putRow(store, A, row('2026-03-31', -2));
  await putRow(store, A, row('2025-12-15', -3));
  await putRow(store, B, row('2026-01-01', -4));
  // A stale total for a month whose rows are gone becomes a tombstone.
  await store.put({ ...sumKey(A, '2026-01'), month: '2026-01', totals: { expense: { Groceries: { ARS: -9 } } }, row_count: 1, computed_at: T0 - 1 });

  const out = await rollup({ sub: A, months: 'all' });
  assert.deepEqual(out, { months: 3 });
  assert.deepEqual((await store.get(sumKey(A, '2026-03'))).totals, { expense: { Groceries: { ARS: -3 } } });
  assert.deepEqual((await store.get(sumKey(A, '2025-12'))).totals, { expense: { Groceries: { ARS: -3 } } });
  assert.equal((await store.get(sumKey(A, '2026-01'))).row_count, 0);
  assert.equal(await store.get(sumKey(B, '2026-01')), undefined, 'only the asked person');
  await assert.rejects(rollup({ sub: A, months: ['2026-01'] }), /unexpected rollup input/);
  await assert.rejects(rollup({ months: 'all' }), /unexpected rollup input/);
});

test('T-ROL-4 POST /totals/rebuild invokes the rollup async and answers 202 with the month count', async () => {
  const store = createMemoryStore();
  await putRow(store, A, row('2026-03-01', -1));
  await putRow(store, A, row('2026-04-01', -1));
  await store.put({ ...sumKey(A, '2026-02'), month: '2026-02', totals: {}, row_count: 0, computed_at: T0 });
  const handler = createWriteHandler({ store, now: () => T0, rollupFunction: 'rollup-fn' });
  const res = await handler(httpEvent(A, 'POST /totals/rebuild'));
  assert.equal(res.statusCode, 202);
  const body = JSON.parse(res.body);
  assert.deepEqual(body, { months: 3 });
  assert.ok(ROUTES['POST /totals/rebuild'].reply.safeParse(body).success);
  assert.deepEqual(store.invocations, [{ functionName: 'rollup-fn', payload: { sub: A, months: 'all' } }]);

  const none = await handler(httpEvent(B, 'POST /totals/rebuild'));
  assert.deepEqual([none.statusCode, JSON.parse(none.body)], [202, { months: 0 }]);
  assert.equal((await handler(httpEvent(null, 'POST /totals/rebuild'))).statusCode, 401);

  // Refused in the erase window (D-30).
  await store.put({ ...erasedKey(A), erased_at: new Date(T0).toISOString() });
  const refused = await handler(httpEvent(A, 'POST /totals/rebuild'));
  assert.deepEqual([refused.statusCode, JSON.parse(refused.body).error.code], [409, 'conflict']);
});
