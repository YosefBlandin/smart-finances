// GET /transactions (D-26) against the in-memory store. Rows are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES } from '@smart-finances/contracts/routes';
import { createMemoryStore } from '../src/store/memory.mjs';
import { ovrKey, txnKey } from '../src/store/keys.mjs';
import { createReadHandler } from '../src/handlers/read.mjs';
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
    description_raw: `made-up row ${n}`,
    source: 'mercadopago',
    source_ref: `r${n}`,
    country: 'AR',
    flags: [],
    import_batch: 'b',
    ...over,
  };
};

async function world() {
  const store = createMemoryStore();
  const put = (sub, t) => store.put({ ...txnKey(sub, t.date, t.id), ...t, period: t.date.slice(0, 7), import_id: 'imp' });
  const handler = createReadHandler({ store, now: () => T0 });
  const get = async (sub, query) => {
    const res = await handler(httpEvent(sub, 'GET /transactions', { queryStringParameters: query }));
    const body = JSON.parse(res.body);
    if (res.statusCode === 200) assert.ok(ROUTES['GET /transactions'].reply.safeParse(body).success, 'reply parses with the contract');
    return { status: res.statusCode, body };
  };
  return { store, put, get };
}

test('T-API-4 the list covers the asked months, applies review choices before filters, and filters by category, kind and text', async () => {
  const w = await world();
  const before = row('2026-02-28', -1);
  const first = row('2026-03-01', -100, { merchant: 'Corner Store' });
  const last = row('2026-04-30', -200, { description_raw: 'Weekly MARKET run' });
  const pay = row('2026-04-05', 90000, { kind: 'income', category: 'Salary' });
  const recat = row('2026-04-10', -300, { flags: ['needs_review'] });
  const after = row('2026-05-01', -1);
  for (const t of [before, first, last, pay, recat, after]) await w.put(A, t);
  await w.put(B, row('2026-03-15', -5));
  await w.store.put({ ...ovrKey(A, recat.date, recat.id), date: recat.date, month: '2026-04', category: 'Dining out', approved: true, updated_at: '2026-11-01T00:00:00.000Z' });

  const all = await w.get(A, { from: '2026-03', to: '2026-04' });
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.items.map((i) => i.id), [last.id, recat.id, pay.id, first.id], 'newest first by default');
  const shown = all.body.items.find((i) => i.id === recat.id);
  assert.equal(shown.category, 'Dining out');
  assert.deepEqual(shown.review, { reasons: [], category_override: 'Dining out', approved: true, updated_at: '2026-11-01T00:00:00.000Z' });
  assert.deepEqual(all.body.items.find((i) => i.id === first.id).review, { reasons: [], approved: false });
  for (const item of all.body.items) for (const key of ['pk', 'sk', 'period', 'import_id']) assert.equal(key in item, false, key);

  assert.deepEqual((await w.get(A, { from: '2026-03', to: '2026-04', category: 'Dining out' })).body.items.map((i) => i.id), [recat.id]);
  assert.deepEqual((await w.get(A, { from: '2026-03', to: '2026-04', category: 'Groceries' })).body.items.map((i) => i.id), [last.id, first.id]);
  assert.deepEqual((await w.get(A, { from: '2026-03', to: '2026-04', kind: 'income' })).body.items.map((i) => i.id), [pay.id]);
  assert.deepEqual((await w.get(A, { from: '2026-03', to: '2026-04', q: 'market' })).body.items.map((i) => i.id), [last.id]);
  assert.deepEqual((await w.get(A, { from: '2026-03', to: '2026-04', q: 'corner' })).body.items.map((i) => i.id), [first.id]);
  assert.deepEqual((await w.get(A, { from: '2026-03', to: '2026-04', q: 'DINING' })).body.items.map((i) => i.id), [recat.id]);
  assert.deepEqual((await w.get(B, { from: '2026-03', to: '2026-04', q: 'market' })).body.items, []);
});

test('T-API-4 sorts by date or amount both ways, ties by date then id, and pages to the end', async () => {
  const w = await world();
  const rows = [];
  for (let i = 0; i < 7; i += 1) rows.push(row(`2026-06-0${(i % 3) + 1}`, -100 * ((i % 2) + 1)));
  for (const t of rows) await w.put(A, t);
  const ids = async (query) => (await w.get(A, { from: '2026-06', to: '2026-06', ...query })).body.items.map((i) => i.id);
  const byDate = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  assert.deepEqual(await ids({ sort: 'date', order: 'asc' }), byDate.map((t) => t.id));
  assert.deepEqual(await ids({ sort: 'date', order: 'desc' }), byDate.map((t) => t.id).reverse());
  const byAmount = [...rows].sort((a, b) => a.amount - b.amount || a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  assert.deepEqual(await ids({ sort: 'amount', order: 'asc' }), byAmount.map((t) => t.id));
  assert.deepEqual(await ids({ sort: 'amount', order: 'desc' }), byAmount.map((t) => t.id).reverse());

  const seen = [];
  let cursor;
  let pages = 0;
  do {
    const page = await w.get(A, { from: '2026-06', to: '2026-06', sort: 'amount', order: 'asc', limit: '3', ...(cursor ? { cursor } : {}) });
    assert.equal(page.status, 200);
    seen.push(...page.body.items.map((i) => i.id));
    cursor = page.body.cursor;
    pages += 1;
  } while (cursor);
  assert.equal(pages, 3);
  assert.deepEqual(seen, byAmount.map((t) => t.id));
});

test('T-API-5 over 36 months, a bad range, sort, order, kind or limit, or a cursor from another query gives bad_request', async () => {
  const w = await world();
  for (let i = 0; i < 3; i += 1) await w.put(A, row('2026-06-01', -1));
  assert.equal((await w.get(A, { from: '2024-01', to: '2026-12' })).status, 200, '36 months is allowed');
  const bad = [
    { from: '2024-01', to: '2027-01' },
    { from: '2026-07', to: '2026-06' },
    { from: '2026-6', to: '2026-06' },
    { to: '2026-06' },
    { from: '2026-06', to: '2026-06', sort: 'merchant' },
    { from: '2026-06', to: '2026-06', order: 'up' },
    { from: '2026-06', to: '2026-06', kind: 'gift' },
    { from: '2026-06', to: '2026-06', limit: '0' },
    { from: '2026-06', to: '2026-06', limit: '201' },
    { from: '2026-06', to: '2026-06', limit: 'ten' },
    { from: '2026-06', to: '2026-06', cursor: 'nonsense' },
  ];
  for (const query of bad) {
    const res = await w.get(A, query);
    assert.deepEqual([res.status, res.body.error?.code], [400, 'bad_request'], JSON.stringify(query));
  }
  const first = await w.get(A, { from: '2026-06', to: '2026-06', limit: '1' });
  assert.ok(first.body.cursor);
  const other = await w.get(A, { from: '2026-06', to: '2026-06', limit: '1', sort: 'amount', cursor: first.body.cursor });
  assert.deepEqual([other.status, other.body.error.code], [400, 'bad_request']);
  const same = await w.get(A, { from: '2026-06', to: '2026-06', limit: '1', cursor: first.body.cursor });
  assert.equal(same.status, 200);
  assert.equal((await w.get(null, { from: '2026-06', to: '2026-06' })).status, 401);
});
