// Month totals (architecture.md Contracts "Rollup", D-14, D-29) against the in-memory store.
// Rows are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/store/memory.mjs';
import { erasedKey, ovrKey, sumKey, txnKey } from '../src/store/keys.mjs';
import { recomputeMonth } from '../src/store/totals.mjs';

const A = 'person-a';
const B = 'person-b';
const T0 = Date.parse('2026-11-01T12:00:00.000Z');

let n = 0;
function row(over = {}) {
  n += 1;
  const id = over.id ?? n.toString(16).padStart(16, '0');
  return {
    id,
    date: '2026-05-10',
    date_precision: 'day',
    kind: 'expense',
    amount: -1000,
    currency: 'ARS',
    category: 'Groceries',
    merchant: '',
    description_raw: 'made-up shop',
    source: 'mercadopago',
    source_ref: `r${n}`,
    country: 'AR',
    flags: [],
    import_batch: 'batch',
    ...over,
  };
}
const putRow = (store, sub, t) => store.put({ ...txnKey(sub, t.date, t.id), ...t, period: t.date.slice(0, 7), import_id: 'imp' });
const putChoice = (store, sub, t, over) =>
  store.put({ ...ovrKey(sub, t.date, t.id), date: t.date, month: t.date.slice(0, 7), approved: false, updated_at: new Date(T0).toISOString(), ...over });

test('T-ROL-1 a month total sums its rows by kind, category and currency, with review choices applied', async () => {
  const store = createMemoryStore();
  const food = row({ amount: -1500 });
  const fee = row({ amount: -250, category: 'Fees & admin' });
  const moved = row({ amount: -700 });
  const usd = row({ amount: -300, currency: 'USD', date: '2026-05-31' });
  const pay = row({ kind: 'income', amount: 500000, category: 'Salary', date: '2026-05-01' });
  const otherMonth = row({ date: '2026-06-01', amount: -99999 });
  const otherPerson = row({ amount: -77777 });
  for (const t of [food, fee, moved, usd, pay, otherMonth]) await putRow(store, A, t);
  await putRow(store, B, otherPerson);
  await putChoice(store, A, moved, { category: 'Dining out' });
  await putChoice(store, A, fee, { approved: true }); // approval changes no total

  const out = await recomputeMonth(store, A, '2026-05', { now: T0 });
  assert.deepEqual(out, { written: true, row_count: 5 });
  const sum = await store.get(sumKey(A, '2026-05'));
  assert.deepEqual(sum.totals, {
    expense: { Groceries: { ARS: -1500, USD: -300 }, 'Fees & admin': { ARS: -250 }, 'Dining out': { ARS: -700 } },
    income: { Salary: { ARS: 500000 } },
  });
  assert.equal(sum.row_count, 5);
  assert.equal(sum.computed_at, T0);
  assert.equal(sum.month, '2026-05');
  assert.equal(await store.get(sumKey(B, '2026-05')), undefined, 'another person is untouched');
});

test('T-ROL-2 a recompute twice gives the same total; an older computation never overwrites a newer one', async () => {
  const store = createMemoryStore();
  const t = row({ amount: -1000 });
  await putRow(store, A, t);
  await recomputeMonth(store, A, '2026-05', { now: T0 });
  const first = await store.get(sumKey(A, '2026-05'));
  assert.deepEqual(await recomputeMonth(store, A, '2026-05', { now: T0 + 1 }), { written: true, row_count: 1 });
  const second = await store.get(sumKey(A, '2026-05'));
  assert.deepEqual(second.totals, first.totals);

  // Two interleaved runs: the later read (T0 + 10) lands first; the earlier read (T0 + 5) then loses.
  await putRow(store, A, row({ amount: -2000 }));
  assert.deepEqual(await recomputeMonth(store, A, '2026-05', { now: T0 + 10 }), { written: true, row_count: 2 });
  assert.deepEqual(await recomputeMonth(store, A, '2026-05', { now: T0 + 5 }), { skipped: true });
  const after = await store.get(sumKey(A, '2026-05'));
  assert.equal(after.computed_at, T0 + 10);
  assert.deepEqual(after.totals, { expense: { Groceries: { ARS: -3000 } } });
  // The same instant does not win either: computed_at must be strictly older.
  assert.deepEqual(await recomputeMonth(store, A, '2026-05', { now: T0 + 10 }), { skipped: true });
});

test('T-ROL-2 an empty month gets a tombstone', async () => {
  const store = createMemoryStore();
  const t = row();
  await putRow(store, A, t);
  await recomputeMonth(store, A, '2026-05', { now: T0 });
  await store.remove(txnKey(A, t.date, t.id));
  assert.deepEqual(await recomputeMonth(store, A, '2026-05', { now: T0 + 1 }), { written: true, row_count: 0 });
  const sum = await store.get(sumKey(A, '2026-05'));
  assert.deepEqual([sum.row_count, sum.totals], [0, {}]);
});

test('T-ROL-2 a recompute during an erase or its quiet window writes nothing; after quiet_until it writes', async () => {
  const store = createMemoryStore();
  await putRow(store, A, row());
  // Erasing: ERASED without quiet_until.
  await store.put({ ...erasedKey(A), erased_at: new Date(T0).toISOString() });
  assert.deepEqual(await recomputeMonth(store, A, '2026-05', { now: T0 + 1 }), { skipped: true });
  assert.equal(await store.get(sumKey(A, '2026-05')), undefined);
  // Quiet: until quiet_until has passed.
  const quietUntil = T0 + 65 * 60_000;
  await store.put({ ...erasedKey(A), erased_at: new Date(T0).toISOString(), quiet_until: new Date(quietUntil).toISOString() });
  assert.deepEqual(await recomputeMonth(store, A, '2026-05', { now: quietUntil }), { skipped: true });
  assert.deepEqual(await recomputeMonth(store, A, '2026-05', { now: quietUntil + 1 }), { written: true, row_count: 1 });
});

test('T-ROL-2 an unexpected store error is thrown, not swallowed', async () => {
  const store = createMemoryStore();
  store.transact = async () => {
    throw new Error('network');
  };
  await assert.rejects(recomputeMonth(store, A, '2026-05', { now: T0 }), /network/);
  await assert.rejects(recomputeMonth(store, A, '2026-5', { now: T0 }), /month/);
});

test('T-ROL-2 both month queries are consistent reads; a transaction conflict is thrown so the batch retries', async () => {
  const store = createMemoryStore();
  const seen = [];
  const realQuery = store.query.bind(store);
  store.query = async (q) => {
    seen.push(q);
    return realQuery(q);
  };
  await recomputeMonth(store, A, '2026-05', { now: T0 });
  assert.equal(seen.length, 2);
  assert.ok(seen.every((q) => q.consistent === true));
  assert.deepEqual(seen.map((q) => q.between[0].slice(0, 4)).sort(), ['OVR#', 'TXN#']);

  store.transact = async () => {
    const err = new Error('cancelled');
    err.name = 'TransactionCanceledException';
    err.CancellationReasons = [{ Code: 'None' }, { Code: 'TransactionConflict' }];
    throw err;
  };
  await assert.rejects(recomputeMonth(store, A, '2026-05', { now: T0 + 1 }), { name: 'TransactionCanceledException' });
});
