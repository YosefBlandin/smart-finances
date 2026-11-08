// The import core against the in-memory store. Rows and files are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/store/memory.mjs';
import { erasedKey, perKey } from '../src/store/keys.mjs';
import { createUlid } from '../src/store/ulid.mjs';
import { createImport, getImport, getPointer, LOCK_MS, takeLock } from '../src/store/imports.mjs';

const A = 'person-a';
const T0 = Date.parse('2026-11-01T12:00:00.000Z');
const MIN = 60_000;
const newIds = () => createUlid({ random: () => Array(16).fill(0) });

async function setup() {
  const store = createMemoryStore();
  const ulid = newIds();
  const make = (over = {}) => createImport(store, A, { source: 'mercadopago', file_name: 'may.csv', size: 100, now: T0, ulid, ...over });
  return { store, make };
}

test('T-REC-1 a new import is requested, has no period yet and a 15-minute form', async () => {
  const { store, make } = await setup();
  const r = await make();
  assert.equal(r.status, 'requested');
  assert.equal(r.period, '');
  assert.equal(r.kind, 'file');
  assert.equal(r.s3_key, `uploads/${A}/${r.import_id}`);
  assert.equal(r.expires_at, new Date(T0 + 15 * MIN).toISOString());
  assert.deepEqual(await getImport(store, A, r.import_id), r);
});

test('T-REC-1 the lock moves requested to importing once and sets lock_until 10 minutes ahead', async () => {
  const { store, make } = await setup();
  const r = await make();
  const first = await takeLock(store, A, r.import_id, { period: '2026-05', now: T0 + MIN });
  assert.equal(first.outcome, 'locked');
  const stored = await getImport(store, A, r.import_id);
  assert.equal(stored.status, 'importing');
  assert.equal(stored.period, '2026-05');
  const p = await getPointer(store, A, 'mercadopago', '2026-05');
  assert.equal(p.lock_import, r.import_id);
  assert.equal(p.lock_until, new Date(T0 + MIN + LOCK_MS).toISOString());
  // A retry or a duplicate event of the same import re-enters through the lock rule.
  const again = await takeLock(store, A, r.import_id, { period: '2026-05', now: T0 + 2 * MIN });
  assert.equal(again.outcome, 'locked');
  assert.equal((await getPointer(store, A, 'mercadopago', '2026-05')).lock_import, r.import_id);
});

test('T-REC-1 a live lock of another record fails a requested import and ignores an importing one', async () => {
  const { store, make } = await setup();
  const first = await make();
  const second = await make();
  assert.equal((await takeLock(store, A, first.import_id, { period: '2026-05', now: T0 + MIN })).outcome, 'locked');
  const refused = await takeLock(store, A, second.import_id, { period: '2026-05', now: T0 + 2 * MIN });
  assert.equal(refused.outcome, 'failed');
  assert.equal((await getImport(store, A, second.import_id)).error.code, 'period_busy');
  // After first's lock expires a third import takes it over; first's late retry is then ignored.
  const third = await make();
  assert.equal((await takeLock(store, A, third.import_id, { period: '2026-05', now: T0 + MIN + LOCK_MS + 1 })).outcome, 'locked');
  const late = await takeLock(store, A, first.import_id, { period: '2026-05', now: T0 + MIN + LOCK_MS + 2 });
  assert.equal(late.outcome, 'ignored');
  assert.equal((await getImport(store, A, first.import_id)).status, 'importing');
  assert.equal((await getPointer(store, A, 'mercadopago', '2026-05')).lock_import, third.import_id);
});

test('T-REC-1 other periods and sources lock on their own', async () => {
  const { store, make } = await setup();
  const may = await make();
  const june = await make();
  const log = await make({ source: 'notion', file_name: 'log.md' });
  assert.equal((await takeLock(store, A, may.import_id, { period: '2026-05', now: T0 })).outcome, 'locked');
  assert.equal((await takeLock(store, A, june.import_id, { period: '2026-06', now: T0 })).outcome, 'locked');
  assert.equal((await takeLock(store, A, log.import_id, { period: 'log', now: T0 })).outcome, 'locked');
});

test('T-REC-1 a file that arrives after the form expired fails', async () => {
  const { store, make } = await setup();
  const r = await make();
  const late = await takeLock(store, A, r.import_id, { period: '2026-05', now: T0 + 16 * MIN, eventTime: T0 + 16 * MIN });
  assert.equal(late.outcome, 'failed');
  const stored = await getImport(store, A, r.import_id);
  assert.equal(stored.status, 'failed');
  assert.equal(stored.error.code, 'form_expired');
  assert.equal(await getPointer(store, A, 'mercadopago', '2026-05'), undefined);
});

test('T-REC-1 the erase window refuses the lock until quiet_until has passed', async () => {
  const { store, make } = await setup();
  // Records made before the erase marked the person; their locks are refused after it.
  const during = await make();
  const quiet = await make({ now: T0 + 60 * MIN - 1 });
  await store.put({ ...erasedKey(A), erased_at: new Date(T0).toISOString() });
  assert.equal((await takeLock(store, A, during.import_id, { period: '2026-05', now: T0 + MIN })).outcome, 'failed');
  assert.equal((await getImport(store, A, during.import_id)).error.code, 'erasing');
  // No new record at all inside the window (D-30).
  await assert.rejects(make({ now: T0 + MIN }), { name: 'Erasing' });

  await store.put({ ...erasedKey(A), erased_at: new Date(T0).toISOString(), quiet_until: new Date(T0 + 70 * MIN).toISOString() });
  assert.equal((await takeLock(store, A, quiet.import_id, { period: '2026-05', now: T0 + 61 * MIN - 1 })).outcome, 'failed');
  await assert.rejects(make({ now: T0 + 70 * MIN }), { name: 'Erasing' });

  const after = await make({ now: T0 + 71 * MIN });
  assert.equal((await takeLock(store, A, after.import_id, { period: '2026-05', now: T0 + 72 * MIN })).outcome, 'locked');
});

test('T-REC-1 a final record is ignored and a missing one is reported', async () => {
  const { store, make } = await setup();
  const r = await make();
  await store.put({ ...(await getImport(store, A, r.import_id)), status: 'done' });
  assert.equal((await takeLock(store, A, r.import_id, { period: '2026-05', now: T0 })).outcome, 'ignored');
  assert.equal((await takeLock(store, A, 'NOPE', { period: '2026-05', now: T0 })).outcome, 'missing');
  assert.equal(await getPointer(store, A, 'mercadopago', '2026-05'), undefined);
});

test('T-REC-1 an importing record that comes back with another period fails', async () => {
  const { store, make } = await setup();
  const r = await make();
  await takeLock(store, A, r.import_id, { period: '2026-05', now: T0 });
  const odd = await takeLock(store, A, r.import_id, { period: '2026-06', now: T0 + MIN });
  assert.equal(odd.outcome, 'failed');
  assert.equal((await getImport(store, A, r.import_id)).error.code, 'period_changed');
});

test('T-REC-1 two runs racing for one period: exactly one holds the lock', async () => {
  const { store, make } = await setup();
  const one = await make();
  const two = await make();
  const results = await Promise.all([
    takeLock(store, A, one.import_id, { period: '2026-05', now: T0 }),
    takeLock(store, A, two.import_id, { period: '2026-05', now: T0 }),
  ]);
  assert.deepEqual(results.map((r) => r.outcome).sort(), ['failed', 'locked']);
  const holder = results.find((r) => r.outcome === 'locked').record.import_id;
  assert.equal((await store.get(perKey(A, 'mercadopago', '2026-05'))).lock_import, holder);
});

// ---- SF-26: commit and reconcile ----
import { commitImport, reconcile } from '../src/store/imports.mjs';
import { monthRange, PREFIX, personPk } from '../src/store/keys.mjs';

const txn = (id, date, over = {}) => ({
  id,
  date,
  date_precision: 'day',
  kind: 'expense',
  amount: -1000,
  currency: 'ARS',
  category: 'Groceries',
  merchant: '',
  description_raw: `row ${id}`,
  source: over.source ?? 'mercadopago',
  source_ref: `f#${id}`,
  country: 'AR',
  flags: [],
  import_batch: 'b',
  ...over,
});

// A fake file store: content_hash and parsed rows per import id.
function harness() {
  const store = createMemoryStore();
  const ulid = newIds();
  const files = new Map();
  const load = async (record) => files.get(record.import_id);
  async function upload({ source = 'mercadopago', period = '2026-05', rows, hash, now = T0 }) {
    const r = await createImport(store, A, { source, file_name: source === 'notion' ? 'log.md' : 'f.csv', size: 10, now, ulid });
    files.set(r.import_id, { transactions: rows, issues: [] });
    return { ...r, period, hash: hash ?? JSON.stringify(rows.map((t) => [t.id, t.date, t.amount])) };
  }
  async function run(up, now = T0 + MIN) {
    const lock = await takeLock(store, A, up.import_id, { period: up.period, now });
    if (lock.outcome !== 'locked') return { lock: lock.outcome };
    const commit = await commitImport(store, A, up.import_id, { content_hash: up.hash, now });
    if (!['committed', 'unchanged'].includes(commit.outcome)) return { lock: lock.outcome, commit: commit.outcome };
    const rec = await reconcile(store, A, up.import_id, { now, load });
    return { lock: lock.outcome, commit: commit.outcome, reconcile: rec.outcome, counts: rec.counts };
  }
  const stored = async (source, period) => [...store.items.values()]
    .filter((i) => i.sk.startsWith(PREFIX.TXN) && i.source === source && i.period === period)
    .map((i) => i.id)
    .sort();
  return { store, files, load, upload, run, stored };
}

test('T-REC-2 the same file twice stores its rows once and the second import ends unchanged', async () => {
  const h = harness();
  const rows = [txn('a', '2026-05-02'), txn('b', '2026-05-03')];
  const first = await h.upload({ rows });
  const r1 = await h.run(first);
  assert.deepEqual([r1.commit, r1.reconcile], ['committed', 'done']);
  assert.deepEqual(r1.counts, { added: 2, updated: 0, removed: 0, skipped: 0 });
  const second = await h.upload({ rows: rows.map((t) => ({ ...t })) });
  const r2 = await h.run(second, T0 + 2 * MIN);
  assert.equal(r2.commit, 'unchanged');
  assert.deepEqual(r2.counts, { added: 0, updated: 0, removed: 0, skipped: 0 });
  assert.equal((await getImport(h.store, A, second.import_id)).status, 'unchanged');
  assert.equal((await getImport(h.store, A, first.import_id)).status, 'done');
  const p = await getPointer(h.store, A, 'mercadopago', '2026-05');
  assert.equal(p.active_import, first.import_id);
  assert.deepEqual(p.history, [first.import_id]);
  assert.equal(p.lock_import, undefined);
  assert.deepEqual(await h.stored('mercadopago', '2026-05'), ['a', 'b']);
});

test('T-REC-3 a corrected file replaces its period rows; other sources and periods keep theirs', async () => {
  const h = harness();
  await h.run(await h.upload({ rows: [txn('a', '2026-05-02'), txn('b', '2026-05-03'), txn('c', '2026-05-04')] }));
  await h.run(await h.upload({ period: '2026-06', rows: [txn('j', '2026-06-01')] }));
  await h.run(await h.upload({ source: 'notion', period: 'log', rows: [txn('n', '2026-05-02', { source: 'notion' })] }));
  const fix = await h.upload({ rows: [txn('a', '2026-05-02'), txn('b', '2026-05-03', { amount: -2000 }), txn('d', '2026-05-09')], now: T0 + MIN });
  const r = await h.run(fix, T0 + 3 * MIN);
  assert.deepEqual([r.commit, r.reconcile], ['committed', 'done']);
  assert.deepEqual(r.counts, { added: 1, updated: 1, removed: 1, skipped: 0 });
  assert.deepEqual(await h.stored('mercadopago', '2026-05'), ['a', 'b', 'd']);
  assert.deepEqual(await h.stored('mercadopago', '2026-06'), ['j']);
  assert.deepEqual(await h.stored('notion', 'log'), ['n']);
  const b = [...h.store.items.values()].find((i) => i.id === 'b');
  assert.equal(b.amount, -2000);
  assert.equal(b.import_id, fix.import_id);
  const p = await getPointer(h.store, A, 'mercadopago', '2026-05');
  assert.equal(p.active_import, fix.import_id);
  assert.equal(p.history.length, 2);
  assert.equal((await getImport(h.store, A, fix.import_id)).replaces, p.history[0]);
});

test('T-REC-3 a row whose date moved leaves no copy under its old key', async () => {
  const h = harness();
  await h.run(await h.upload({ rows: [txn('a', '2026-05-02')] }));
  await h.run(await h.upload({ rows: [txn('a', '2026-05-20')], now: T0 + MIN }), T0 + 2 * MIN);
  const copies = [...h.store.items.values()].filter((i) => i.id === 'a');
  assert.deepEqual(copies.map((i) => i.date), ['2026-05-20']);
});

test('T-REC-4 a late retry of an older import after a newer one committed leaves the newer rows', async () => {
  const h = harness();
  const older = await h.upload({ rows: [txn('old', '2026-05-02')] });
  const newer = await h.upload({ rows: [txn('new', '2026-05-03')] });
  // older locks, then its run dies before commit; newer takes over after lock_until.
  assert.equal((await takeLock(h.store, A, older.import_id, { period: '2026-05', now: T0 + MIN })).outcome, 'locked');
  const r = await h.run(newer, T0 + MIN + LOCK_MS + 1);
  assert.equal(r.reconcile, 'done');
  assert.equal((await getImport(h.store, A, older.import_id)).status, 'superseded');
  const retry = await h.run(older, T0 + MIN + LOCK_MS + 2);
  assert.equal(retry.lock, 'ignored');
  assert.deepEqual(await h.stored('mercadopago', '2026-05'), ['new']);
});

test('T-REC-4 an older import that commits after a newer one is superseded and writes nothing', async () => {
  const h = harness();
  const older = await h.upload({ rows: [txn('old', '2026-05-02')] });
  const newer = await h.upload({ rows: [txn('new', '2026-05-03')] });
  await h.run(newer);
  // older was never marked (it was still requested), so it locks and then loses at commit.
  const r = await h.run(older, T0 + 2 * MIN);
  assert.deepEqual([r.lock, r.commit], ['locked', 'superseded']);
  assert.equal((await getImport(h.store, A, older.import_id)).status, 'superseded');
  assert.equal((await getPointer(h.store, A, 'mercadopago', '2026-05')).lock_import, undefined);
  assert.deepEqual(await h.stored('mercadopago', '2026-05'), ['new']);
});

test('T-REC-4 one event delivered twice and concurrently gives the file rows once', async () => {
  const h = harness();
  const up = await h.upload({ rows: [txn('a', '2026-05-02'), txn('b', '2026-05-03')] });
  const both = await Promise.all([h.run(up), h.run(up)]);
  assert.ok(both.some((r) => r.reconcile === 'done'));
  assert.equal((await getImport(h.store, A, up.import_id)).status, 'done');
  assert.deepEqual(await h.stored('mercadopago', '2026-05'), ['a', 'b']);
  assert.equal((await getPointer(h.store, A, 'mercadopago', '2026-05')).lock_import, undefined);
});

test('T-REC-4 a crash after some puts, then the retry, leaves exactly the file rows', async () => {
  const h = harness();
  await h.run(await h.upload({ rows: [txn('a', '2026-05-02'), txn('gone', '2026-05-05')] }));
  const fix = await h.upload({ rows: [txn('a', '2026-05-02', { amount: -5 }), txn('b', '2026-05-03'), txn('c', '2026-05-04')], now: T0 + MIN });
  const realPut = h.store.put.bind(h.store);
  let puts = 0;
  h.store.put = async (item, opts) => {
    if (item.sk.startsWith(PREFIX.TXN) && ++puts === 2) throw new Error('crash');
    return realPut(item, opts);
  };
  await assert.rejects(h.run(fix, T0 + 2 * MIN), /crash/);
  h.store.put = realPut;
  const retry = await h.run(fix, T0 + 3 * MIN);
  assert.deepEqual([retry.lock, retry.commit, retry.reconcile], ['locked', 'committed', 'done']);
  assert.deepEqual(await h.stored('mercadopago', '2026-05'), ['a', 'b', 'c']);
  assert.equal((await getImport(h.store, A, fix.import_id)).status, 'done');
});

test('T-REC-4 a takeover after lock_until: the first run, back late, cannot move or release the lock', async () => {
  const h = harness();
  const first = await h.upload({ rows: [txn('a', '2026-05-02')] });
  const second = await h.upload({ rows: [txn('b', '2026-05-03')] });
  await takeLock(h.store, A, first.import_id, { period: '2026-05', now: T0 });
  await takeLock(h.store, A, second.import_id, { period: '2026-05', now: T0 + LOCK_MS + 1 });
  // first wakes up and tries to commit and reconcile while second holds the lock.
  assert.equal((await commitImport(h.store, A, first.import_id, { content_hash: first.hash, now: T0 + LOCK_MS + 2 })).outcome, 'lost_lock');
  assert.equal((await reconcile(h.store, A, first.import_id, { now: T0 + LOCK_MS + 2, load: h.load })).outcome, 'lost_lock');
  assert.equal((await getPointer(h.store, A, 'mercadopago', '2026-05')).lock_import, second.import_id);
  await commitImport(h.store, A, second.import_id, { content_hash: second.hash, now: T0 + LOCK_MS + 3 });
  await reconcile(h.store, A, second.import_id, { now: T0 + LOCK_MS + 3, load: h.load });
  assert.deepEqual(await h.stored('mercadopago', '2026-05'), ['b']);
  assert.equal((await getImport(h.store, A, first.import_id)).status, 'superseded');
});

test('T-REC-7 reconcile of a month period reads only that month; a log period reads all and keeps other sources', async () => {
  const h = harness();
  await h.run(await h.upload({ period: '2026-04', rows: [txn('apr', '2026-04-02')] }));
  await h.run(await h.upload({ source: 'notion', period: 'log', rows: [txn('n1', '2026-04-03', { source: 'notion' })] }));
  await h.run(await h.upload({ source: 'csv', period: 'log', rows: [txn('c1', '2026-04-03', { source: 'csv' })] }));
  const queries = [];
  const realQuery = h.store.query.bind(h.store);
  h.store.query = async (q) => {
    queries.push(q);
    return realQuery(q);
  };
  await h.run(await h.upload({ rows: [txn('may', '2026-05-02')] }), T0 + 2 * MIN);
  const txnQueries = queries.filter((q) => (q.prefix ?? q.between?.[0] ?? '').startsWith(PREFIX.TXN));
  assert.deepEqual(txnQueries.map((q) => q.between), [monthRange(PREFIX.TXN, '2026-05', '2026-05')]);
  assert.ok(txnQueries.every((q) => q.pk === personPk(A)));
  assert.deepEqual(await h.stored('mercadopago', '2026-04'), ['apr']);

  queries.length = 0;
  await h.run(await h.upload({ source: 'notion', period: 'log', rows: [txn('n2', '2026-03-01', { source: 'notion' })], now: T0 + 2 * MIN }), T0 + 3 * MIN);
  const logQueries = queries.filter((q) => (q.prefix ?? q.between?.[0] ?? '').startsWith(PREFIX.TXN));
  assert.deepEqual(logQueries.map((q) => q.prefix), [PREFIX.TXN]);
  assert.deepEqual(await h.stored('notion', 'log'), ['n2']);
  assert.deepEqual(await h.stored('csv', 'log'), ['c1']);
  assert.deepEqual(await h.stored('mercadopago', '2026-04'), ['apr']);
});

// ---- SF-25 review fixes ----
test('T-REC-1 ULIDs sort by time, stay in order within one millisecond and when the clock goes back', () => {
  const ulid = createUlid();
  const a = ulid(T0);
  const b = ulid(T0);
  const c = ulid(T0 - 5);
  const d = ulid(T0 + 1);
  assert.match(a, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(a < b && b < c && c < d, [a, b, c, d].join(' '));
  assert.equal(a.slice(0, 10), b.slice(0, 10));
  const full = createUlid({ random: () => Array(16).fill(31) });
  full(T0);
  assert.throws(() => full(T0), /overflow/);
});

test('T-REC-1 an erase that starts between the read and the lock write still refuses the lock', async () => {
  const { store, make } = await setup();
  const r = await make();
  const realTransact = store.transact.bind(store);
  let once = true;
  store.transact = async (ops) => {
    if (once) {
      once = false;
      await store.put({ ...erasedKey(A), erased_at: new Date(T0).toISOString() });
    }
    return realTransact(ops);
  };
  const out = await takeLock(store, A, r.import_id, { period: '2026-05', now: T0 + MIN });
  assert.equal(out.outcome, 'failed');
  assert.equal((await getImport(store, A, r.import_id)).error.code, 'erasing');
  assert.equal(await getPointer(store, A, 'mercadopago', '2026-05'), undefined);
});

test('T-REC-1 a failed import that held its lock releases it, and an event at exactly expires_at fails', async () => {
  const { store, make } = await setup();
  const r = await make();
  await takeLock(store, A, r.import_id, { period: '2026-05', now: T0 });
  assert.equal((await takeLock(store, A, r.import_id, { period: '2026-06', now: T0 + MIN })).outcome, 'failed');
  assert.equal((await getPointer(store, A, 'mercadopago', '2026-05')).lock_import, undefined);
  const next = await make();
  assert.equal((await takeLock(store, A, next.import_id, { period: '2026-05', now: T0 + 2 * MIN })).outcome, 'locked');
  const edge = await make();
  assert.equal((await takeLock(store, A, edge.import_id, { period: '2026-07', now: T0 + 15 * MIN, eventTime: T0 + 15 * MIN })).outcome, 'failed');
});

test('T-REC-1 a transaction cancelled for a conflict is read again, not thrown', async () => {
  const { store, make } = await setup();
  const r = await make();
  const realTransact = store.transact.bind(store);
  let once = true;
  store.transact = async (ops) => {
    if (once) {
      once = false;
      throw Object.assign(new Error('cancelled'), { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'None' }, { Code: 'TransactionConflict' }] });
    }
    return realTransact(ops);
  };
  assert.equal((await takeLock(store, A, r.import_id, { period: '2026-05', now: T0 })).outcome, 'locked');
});

// ---- SF-26 review fixes ----
test('T-REC-4 a retry after a crash part-way still reports what the import changed', async () => {
  const h = harness();
  await h.run(await h.upload({ rows: [txn('a', '2026-05-02')] }));
  const fix = await h.upload({ rows: [txn('a', '2026-05-02'), txn('b', '2026-05-03'), txn('c', '2026-05-04')], now: T0 + MIN });
  const realPut = h.store.put.bind(h.store);
  let puts = 0;
  h.store.put = async (item, opts) => {
    if (item.sk.startsWith(PREFIX.TXN) && ++puts === 3) throw new Error('crash');
    return realPut(item, opts);
  };
  await assert.rejects(h.run(fix, T0 + 2 * MIN), /crash/);
  h.store.put = realPut;
  const retry = await h.run(fix, T0 + 3 * MIN);
  assert.deepEqual(retry.counts, { added: 2, updated: 0, removed: 0, skipped: 0 });
  const rec = await getImport(h.store, A, fix.import_id);
  assert.deepEqual(rec.counts, { added: 2, updated: 0, removed: 0, skipped: 0 });
  assert.equal(rec.planned_counts, undefined);
});

test('T-REC-4 a late reconcile whose lock was taken over writes no rows', async () => {
  const h = harness();
  const first = await h.upload({ rows: [txn('a', '2026-05-02')] });
  await takeLock(h.store, A, first.import_id, { period: '2026-05', now: T0 });
  await commitImport(h.store, A, first.import_id, { content_hash: first.hash, now: T0 });
  const second = await h.upload({ rows: [txn('b', '2026-05-03')], now: T0 + LOCK_MS + 1 });
  // first's reconcile starts, but another run takes the lock just after its check.
  const realGet = h.store.get.bind(h.store);
  let stolen = false;
  h.store.get = async (key, opts) => {
    const out = await realGet(key, opts);
    if (!stolen && key.sk.startsWith('PER#') && out?.lock_import === first.import_id) {
      stolen = true;
      await realPut({ ...out, lock_import: second.import_id, rev: out.rev + 1 });
      return out;
    }
    return out;
  };
  const realPut = h.store.put.bind(h.store);
  const out = await reconcile(h.store, A, first.import_id, { now: T0 + 1, load: h.load });
  assert.equal(out.outcome, 'lost_lock');
  assert.deepEqual(await h.stored('mercadopago', '2026-05'), []);
});

test('T-REC-4 a row whose twin is stored from another file is flagged possible_duplicate, the same on a re-run', async () => {
  const h = harness();
  // February's workbook has the payment on its day; March's lists it again, dated in February.
  const feb = await h.upload({ source: 'excel', period: '2026-02', rows: [txn('f1', '2026-02-10', { source: 'excel', description_raw: 'Market' })] });
  await h.run(feb);
  const march = await h.upload({ source: 'excel', period: '2026-03', rows: [txn('m1', '2026-03-01', { source: 'excel', date_precision: 'month', source_ref: 'b_Mar.xlsx#A5 (x)', description_raw: 'Market' })] });
  h.files.get(march.import_id).issues = [{ ref: 'b_Mar.xlsx#A5', statedDate: '2026-02-10', amount: -1000, description: 'MARKET', info: true, issue: 'date in another month' }];
  await h.run(march, T0 + 2 * MIN);
  const flagged = () => [...h.store.items.values()].filter((i) => i.sk.startsWith(PREFIX.TXN)).map((i) => [i.id, i.flags.join('|')]).sort();
  assert.deepEqual(flagged(), [['f1', ''], ['m1', 'possible_duplicate']]);
  const repairLike = await h.upload({ source: 'excel', period: '2026-03', rows: h.files.get(march.import_id).transactions, hash: march.hash, now: T0 + 2 * MIN });
  h.files.set(repairLike.import_id, h.files.get(march.import_id));
  await h.run(repairLike, T0 + 3 * MIN);
  assert.deepEqual(flagged(), [['f1', ''], ['m1', 'possible_duplicate']]);
});
