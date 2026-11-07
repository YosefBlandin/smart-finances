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
  await store.put({ ...erasedKey(A), erased_at: new Date(T0).toISOString() });
  const during = await make();
  assert.equal((await takeLock(store, A, during.import_id, { period: '2026-05', now: T0 + MIN })).outcome, 'failed');
  assert.equal((await getImport(store, A, during.import_id)).error.code, 'erasing');

  await store.put({ ...erasedKey(A), erased_at: new Date(T0).toISOString(), quiet_until: new Date(T0 + 70 * MIN).toISOString() });
  const quiet = await make({ now: T0 + 60 * MIN });
  assert.equal((await takeLock(store, A, quiet.import_id, { period: '2026-05', now: T0 + 61 * MIN })).outcome, 'failed');

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
