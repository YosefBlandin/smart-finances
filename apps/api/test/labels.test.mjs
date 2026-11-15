// Recipient labels (D-13, D-18): one stored label per recipient key, applied wherever rows are read, and in totals.
// Rows, names and keys are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES } from '@smart-finances/contracts/routes';
import { createMemoryStore } from '../src/store/memory.mjs';
import { lblKey, ovrKey, PREFIX, txnKey } from '../src/store/keys.mjs';
import { putLabel, readLabels } from '../src/store/labels.mjs';
import { putReview } from '../src/store/review.mjs';
import { monthsWithData, recomputeMonth } from '../src/store/totals.mjs';
import { createReadHandler } from '../src/handlers/read.mjs';
import { httpEvent } from './fixtures/http.mjs';

const A = 'person-a';
const B = 'person-b';
const T0 = Date.parse('2026-11-01T12:00:00.000Z');
const K = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);

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
    category: 'Uncategorized',
    merchant: '',
    recipient_key: '',
    description_raw: `made-up row ${n}`,
    source: 'mercadopago',
    source_ref: `r${n}`,
    country: 'AR',
    flags: ['needs_review'],
    import_batch: 'b',
    ...over,
  };
};

function world() {
  const store = createMemoryStore();
  const put = (sub, t) => store.put({ ...txnKey(sub, t.date, t.id), ...t, period: t.date.slice(0, 7), import_id: 'imp' });
  const read = createReadHandler({ store, now: () => T0 });
  const call = async (sub, routeKey, query) => {
    const res = await read(httpEvent(sub, routeKey, query ? { queryStringParameters: query } : {}));
    const body = routeKey === 'GET /export' ? res.body : JSON.parse(res.body);
    assert.equal(res.statusCode, 200, routeKey);
    assert.ok(ROUTES[routeKey].reply.safeParse(body).success, `${routeKey} reply parses`);
    return body;
  };
  const list = (sub) => call(sub, 'GET /transactions', { from: '2026-01', to: '2026-12' }).then((b) => Object.fromEntries(b.items.map((i) => [i.id, i])));
  const review = (sub) => call(sub, 'GET /review').then((b) => b.items.map((i) => i.id));
  const rebuild = async (sub, now) => {
    for (const month of await monthsWithData(store, sub)) await recomputeMonth(store, sub, month, { now });
  };
  const totals = (sub) => call(sub, 'GET /totals', { from: '2026-01', to: '2026-12' });
  return { store, put, list, review, rebuild, totals, call };
}

// The expense totals the reads imply: shown rows summed by shown category.
const expectedTotals = (items) => {
  const out = {};
  for (const i of Object.values(items)) {
    const byCat = ((out[i.date.slice(0, 7)] ??= {})[i.kind] ??= {});
    (byCat[i.category] ??= {})[i.currency] = ((byCat[i.category] ??= {})[i.currency] ?? 0) + i.amount;
  }
  return out;
};
const storedTotals = (body) => Object.fromEntries(body.months.map((m) => [m.month, m.totals]));

test('T-ENR-8 a label sets name, category and approval on every stored row with its key, over an earlier row choice', async () => {
  const w = world();
  const plain = row('2026-10-02', -1000, { merchant: 'Made-up Shop', recipient_key: K });
  const chosen = row('2026-10-03', -2000, { recipient_key: K });
  const other = row('2026-10-04', -3000, { recipient_key: OTHER });
  const keyless = row('2026-10-05', -4000);
  for (const t of [plain, chosen, other, keyless]) await w.put(A, t);
  await w.store.put({ ...ovrKey(A, chosen.date, chosen.id), date: chosen.date, month: '2026-10', category: 'Groceries', approved: false, updated_at: '2026-11-01T00:00:00.000Z' });

  const out = await putLabel(w.store, A, K, { name: '  Made-up Landlord  ', category: 'Housing & utilities' }, { now: T0 });
  assert.deepEqual(out, { label: { recipient_key: K, name: 'Made-up Landlord', category: 'Housing & utilities', updated_at: new Date(T0).toISOString() } });
  assert.deepEqual([...(await readLabels(w.store, A)).keys()], [K]);
  assert.equal((await w.store.get(lblKey(A, K))).name, 'Made-up Landlord');

  const items = await w.list(A);
  for (const t of [plain, chosen]) {
    assert.equal(items[t.id].merchant, 'Made-up Landlord', 'the label name replaces the shown merchant');
    assert.equal(items[t.id].category, 'Housing & utilities', 'the label category beats the row choice');
    assert.equal(items[t.id].review.approved, true);
    assert.deepEqual(items[t.id].review.reasons, []);
  }
  assert.deepEqual([items[other.id].merchant, items[other.id].category, items[other.id].review.approved], ['', 'Uncategorized', false]);
  assert.deepEqual([items[keyless.id].category, items[keyless.id].review.approved], ['Uncategorized', false]);
  assert.deepEqual((await w.review(A)).sort(), [other.id, keyless.id].sort(), 'labeled rows leave the review list');

  const csv = await w.call(A, 'GET /export');
  assert.match(csv, /Made-up Landlord/);
  assert.doesNotMatch(csv, /Made-up Shop/);

  // the other person sees none of it
  await w.put(B, row('2026-10-02', -5, { recipient_key: K }));
  assert.equal(Object.values(await w.list(B))[0].merchant, '');
});

test('T-ENR-8 a row imported after the label shows it at once, and totals follow the label', async () => {
  const w = world();
  await putLabel(w.store, A, K, { name: 'Made-up Gym', category: 'Health & fitness' }, { now: T0 });
  const later = row('2026-09-10', -1500, { recipient_key: K });
  const unlabeled = row('2026-09-11', -700);
  await w.put(A, later);
  await w.put(A, unlabeled);
  const items = await w.list(A);
  assert.deepEqual([items[later.id].merchant, items[later.id].category, items[later.id].review.approved], ['Made-up Gym', 'Health & fitness', true]);
  await w.rebuild(A, T0 + 1);
  assert.deepEqual(storedTotals(await w.totals(A)), expectedTotals(items));
  assert.equal(storedTotals(await w.totals(A))['2026-09'].expense['Health & fitness'].ARS, -1500);
});

test('T-ENR-8 a review choice saved on a labeled row answers with the label applied', async () => {
  const w = world();
  const t = row('2026-10-02', -1000, { recipient_key: K });
  await w.put(A, t);
  await putLabel(w.store, A, K, { name: 'Made-up Cafe', category: 'Dining out' }, { now: T0 });
  const out = await putReview(w.store, A, t.id, { date: t.date, category: 'Groceries' }, { now: T0 + 1 });
  assert.equal(out.review.approved, true);
  assert.deepEqual(out.review.reasons, []);
  assert.equal((await w.list(A))[t.id].category, 'Dining out');
});

test('T-ENR-8 labeling again replaces the label; a write during an erase is refused', async () => {
  const w = world();
  await putLabel(w.store, A, K, { name: 'First', category: 'Groceries' }, { now: T0 });
  await putLabel(w.store, A, K, { name: 'Second', category: 'Transport' }, { now: T0 + 1 });
  const labels = await readLabels(w.store, A);
  assert.deepEqual([labels.size, labels.get(K).name, labels.get(K).category], [1, 'Second', 'Transport']);
  await w.store.put({ pk: `U#${A}`, sk: 'ERASED', erased_at: new Date(T0).toISOString() });
  assert.deepEqual(await putLabel(w.store, A, OTHER, { name: 'X', category: 'Groceries' }, { now: T0 + 2 }), { error: 'conflict' });
  assert.equal((await readLabels(w.store, A)).has(OTHER), false);
  assert.ok([...w.store.items.values()].filter((i) => i.sk.startsWith(PREFIX.LBL)).every((i) => i.pk === `U#${A}`));
});

test('T-ENR-10 two label writes back to back, with rebuilds finishing in either order, leave totals that match the reads', async () => {
  for (const order of [['first', 'second'], ['second', 'first']]) {
    const w = world();
    await w.put(A, row('2026-10-02', -1000, { recipient_key: K }));
    await w.put(A, row('2026-10-03', -2000, { recipient_key: K }));
    await w.put(A, row('2026-11-01', -500, { recipient_key: K }));
    await w.rebuild(A, T0); // totals before any label
    // label 1, then label 2; each write asks for a rebuild that starts after its commit
    await putLabel(w.store, A, K, { name: 'Made-up One', category: 'Groceries' }, { now: T0 + 10 });
    await putLabel(w.store, A, K, { name: 'Made-up Two', category: 'Transport' }, { now: T0 + 20 });
    const rebuilds = { first: () => w.rebuild(A, T0 + 11), second: () => w.rebuild(A, T0 + 21) };
    for (const which of order) await rebuilds[which]();
    const items = await w.list(A);
    assert.ok(Object.values(items).every((i) => i.category === 'Transport'), order.join(','));
    assert.deepEqual(storedTotals(await w.totals(A)), expectedTotals(items), order.join(','));
  }
});

test('T-ENR-10 a rebuild that read the first label and finishes after the second label\'s rebuild never overwrites it', async () => {
  const w = world();
  await w.put(A, row('2026-10-02', -1000, { recipient_key: K }));
  await putLabel(w.store, A, K, { name: 'Made-up One', category: 'Groceries' }, { now: T0 + 10 });
  // The first rebuild reads the month (label 1) and is held just before it writes the total.
  const transact = w.store.transact.bind(w.store);
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let held = false;
  w.store.transact = async (ops) => {
    if (!held && ops.some((o) => o.put?.sk?.startsWith(PREFIX.SUM))) {
      held = true;
      await gate;
    }
    return transact(ops);
  };
  const stale = recomputeMonth(w.store, A, '2026-10', { now: T0 + 11 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(held, true, 'the first rebuild is waiting to write');
  await putLabel(w.store, A, K, { name: 'Made-up Two', category: 'Transport' }, { now: T0 + 20 });
  await w.rebuild(A, T0 + 21);
  release();
  assert.deepEqual(await stale, { skipped: true });
  const items = await w.list(A);
  assert.deepEqual(storedTotals(await w.totals(A)), expectedTotals(items));
  assert.equal(storedTotals(await w.totals(A))['2026-10'].expense.Transport.ARS, -1000);
});
