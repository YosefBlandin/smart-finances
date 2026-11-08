// Delete-all and the quiet window (D-30, D-40) against the in-memory store. Files are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES } from '@smart-finances/contracts/routes';
import { createMemoryStore } from '../src/store/memory.mjs';
import { erasedKey, impKey, ovrKey, perKey, rateKey, sumKey } from '../src/store/keys.mjs';
import { createUlid } from '../src/store/ulid.mjs';
import { LOCK_MS } from '../src/store/imports.mjs';
import { QUIET_MS } from '../src/store/erase.mjs';
import { createDeleteHandler } from '../src/handlers/delete.mjs';
import { createParserHandler, objectCreated } from '../src/handlers/parser.mjs';
import { createReadHandler } from '../src/handlers/read.mjs';
import { createRollupHandler } from '../src/handlers/rollup.mjs';
import { createWriteHandler } from '../src/handlers/write.mjs';
import { httpEvent } from './fixtures/http.mjs';

const A = 'person-a';
const B = 'person-b';
const T0 = Date.parse('2026-11-01T12:00:00.000Z');
const MIN = 60_000;
const csv = (lines) => ['date,description,amount,currency,account', ...lines].join('\n');

function world() {
  const store = createMemoryStore();
  let clock = T0;
  const now = () => clock;
  const ulid = createUlid();
  const write = createWriteHandler({ store, now, ulid, parserFunction: 'parser-fn', rollupFunction: 'rollup-fn' });
  const read = createReadHandler({ store, now });
  const del = createDeleteHandler({ store, now });
  const parser = createParserHandler({ store, now });
  const rollup = createRollupHandler({ store, now });
  const call = async (handler, sub, routeKey, opts) => {
    const res = await handler(httpEvent(sub, routeKey, opts));
    const body = res.headers?.['content-type']?.startsWith('application/json') ? JSON.parse(res.body) : res.body;
    if (res.statusCode < 300 && routeKey !== 'GET /export') assert.ok(ROUTES[routeKey].reply.safeParse(body).success, `${routeKey} reply parses`);
    return { status: res.statusCode, body };
  };
  // An upload through the write handler, its file, then the parser's Object Created event.
  async function upload(sub, lines, { arrive = true } = {}) {
    const body = csv(lines);
    const res = await call(write, sub, 'POST /imports', { body: { source: 'csv', file_name: 'demo.csv', size: Buffer.byteLength(body) } });
    if (res.status !== 201) return res;
    const key = res.body.upload.fields.key;
    if (arrive) {
      store.putObject(key, body);
      await parser(objectCreated(key, new Date(clock).toISOString()));
    }
    return res;
  }
  const partition = (sub) => [...store.items.values()].filter((i) => i.pk === `U#${sub}`);
  const objects = (sub) => [...store.objects.keys()].filter((k) => k.startsWith(`uploads/${sub}/`));
  return {
    store,
    tick: (ms) => (clock += ms),
    now,
    upload,
    partition,
    objects,
    rollup,
    parser,
    del,
    erase: (sub, body = { confirm: 'DELETE' }) => call(del, sub, 'DELETE /data', { body }),
    totals: (sub) => call(read, sub, 'GET /totals', { queryStringParameters: { from: '2026-01', to: '2026-12' } }),
    writeCall: (sub, routeKey, opts) => call(write, sub, routeKey, opts),
    readCall: (sub, routeKey, opts) => call(read, sub, routeKey, opts),
  };
}

async function seed(w, sub) {
  await w.upload(sub, ['2026-03-01,Shop,-1.00,ARS,acc', '2026-04-02,Pay,2.00,ARS,acc']);
  await w.store.put({ ...rateKey(sub, '2026-03'), ars_per_usd: '1000.00', updated_at: 'x' });
  await w.store.put({ ...ovrKey(sub, '2026-03-01', '00000000000000aa'), date: '2026-03-01', month: '2026-03', approved: true, updated_at: 'x' });
  await w.store.put({ ...sumKey(sub, '2026-03'), month: '2026-03', totals: { expense: { Groceries: { ARS: -100 } } }, row_count: 1, computed_at: T0 });
}

test('T-ERA-1 delete-all removes every item but ERASED and every file under the person, then sets quiet_until 65 minutes on', async () => {
  const w = world();
  await seed(w, A);
  await seed(w, B);
  const itemsBefore = w.partition(A).length;
  const filesBefore = w.objects(A).length;
  assert.ok(itemsBefore >= 7 && filesBefore === 1);
  const bOnly = JSON.stringify(w.partition(B));

  for (const body of [{}, { confirm: 'delete' }, 'not json']) {
    const bad = await w.erase(A, body);
    assert.deepEqual([bad.status, bad.body.error.code], [400, 'bad_request'], JSON.stringify(body));
  }
  assert.equal(w.partition(A).length, itemsBefore, 'nothing deleted by a bad request');
  assert.equal((await w.erase(null)).status, 401);

  w.tick(MIN);
  const res = await w.erase(A);
  assert.equal(res.status, 202);
  assert.deepEqual(res.body, { deleted: { items: itemsBefore, files: filesBefore } });
  assert.deepEqual(w.partition(A).map((i) => i.sk), ['ERASED']);
  assert.deepEqual(w.objects(A), []);
  const marker = await w.store.get(erasedKey(A));
  assert.equal(marker.erased_at, new Date(T0 + MIN).toISOString());
  assert.equal(marker.quiet_until, new Date(T0 + MIN + QUIET_MS).toISOString());
  assert.equal(JSON.stringify(w.partition(B)), bOnly, 'the other person is untouched');
  assert.equal(w.objects(B).length, 1);

  // Again inside the quiet window: nothing left, zero counts.
  assert.deepEqual((await w.erase(A)).body, { deleted: { items: 0, files: 0 } });
});

test('T-ERA-1 the direct { sub } invoke runs the same erase; a finished erase returns zero counts; bad input throws', async () => {
  const w = world();
  await seed(w, A);
  const items = w.partition(A).length;
  assert.deepEqual(await w.del({ sub: A }), { deleted: { items, files: 1 } });
  assert.deepEqual(w.partition(A).map((i) => i.sk), ['ERASED']);
  assert.deepEqual(await w.del({ sub: A }), { deleted: { items: 0, files: 0 } });
  await assert.rejects(w.del({}), /unexpected delete input/);
  await assert.rejects(w.del({ sub: '' }), /unexpected delete input/);
  await assert.rejects(w.del({ sub: A, extra: 1 }), /unexpected delete input/);
  // After the quiet window, new data can be stored and erased again.
  w.tick(QUIET_MS + MIN);
  await w.upload(A, ['2026-05-01,Again,-1.00,ARS,acc']);
  const again = await w.del({ sub: A });
  assert.ok(again.deleted.items >= 2 && again.deleted.files === 1, JSON.stringify(again));
});

test('T-ERA-2 delete-all is refused while a period lock is live or an upload form is open, and leaves everything as it was', async () => {
  const w = world();
  await seed(w, A);
  const pointer = await w.store.get(perKey(A, 'csv', 'log'));
  await w.store.put({ ...pointer, lock_import: 'someone', lock_until: new Date(T0 + LOCK_MS).toISOString(), rev: pointer.rev + 1 });
  const before = JSON.stringify(w.partition(A));
  const locked = await w.erase(A);
  assert.deepEqual([locked.status, locked.body.error.code], [409, 'conflict']);
  assert.equal(JSON.stringify(w.partition(A)), before, 'no marker left behind');
  await assert.rejects(w.del({ sub: A }), /erase refused/);

  // After lock_until the import is stalled; then the erase works.
  w.tick(LOCK_MS + 1);
  await w.upload(A, ['2026-05-01,Later,-1.00,ARS,acc'], { arrive: false });
  const open = await w.erase(A);
  assert.deepEqual([open.status, open.body.error.code], [409, 'conflict'], 'an upload form is still open');
  w.tick(15 * MIN);
  assert.equal((await w.erase(A)).status, 202, 'the form expired');
  assert.deepEqual(w.partition(A).map((i) => i.sk), ['ERASED']);
});

test('T-ERA-2 in the window imports, undo, repair, rebuild, rates, review and totals get conflict and rollups write nothing; after it they work', async () => {
  const w = world();
  await seed(w, A);
  const firstImport = (await w.readCall(A, 'GET /imports')).body.items[0].import_id;
  assert.equal((await w.erase(A)).status, 202);

  const conflict = async (res, what) => assert.deepEqual([res.status, res.body.error?.code], [409, 'conflict'], what);
  await conflict(await w.writeCall(A, 'POST /imports', { body: { source: 'csv', file_name: 'demo.csv', size: 10 } }), 'POST /imports');
  assert.equal(w.store.invocations.length, 0);
  await conflict(await w.writeCall(A, 'POST /imports/{id}/undo', { pathParameters: { id: firstImport } }), 'undo');
  await conflict(await w.writeCall(A, 'POST /periods/{source}/{period}/repair', { pathParameters: { source: 'csv', period: 'log' } }), 'repair');
  await conflict(await w.writeCall(A, 'POST /totals/rebuild'), 'rebuild');
  await conflict(await w.writeCall(A, 'PUT /rates/{month}', { pathParameters: { month: '2026-03' }, body: { ars_per_usd: 1000 } }), 'rates');
  await conflict(await w.totals(A), 'totals');
  // A late stream record of an erased row: the rollup writes nothing.
  await w.rollup({ Records: [{ dynamodb: { Keys: { pk: { S: `U#${A}` }, sk: { S: 'TXN#2026-03-01#0000000000000001' } } } }] });
  await w.rollup({ sub: A, months: 'all' });
  assert.deepEqual(w.partition(A).map((i) => i.sk), ['ERASED']);
  // The other person is not affected.
  assert.equal((await w.totals(B)).status, 200);

  w.tick(QUIET_MS + 1);
  assert.equal((await w.totals(A)).status, 200);
  const res = await w.upload(A, ['2026-06-01,New,-1.00,ARS,acc']);
  assert.equal(res.status, 201);
  assert.equal((await w.readCall(A, 'GET /transactions', { queryStringParameters: { from: '2026-06', to: '2026-06' } })).body.items.length, 1);
  assert.ok(w.partition(A).some((i) => i.sk === 'ERASED'), 'ERASED is never removed');
});

test('T-ERA-3 a crash mid-erase leaves quiet_until unset and everything refused; a repeat call finishes it', async () => {
  const w = world();
  await seed(w, A);
  const items = w.partition(A).length;
  const realRemove = w.store.remove.bind(w.store);
  let removed = 0;
  w.store.remove = async (key, opts) => {
    if (key.sk !== 'ERASED' && removed >= 2) throw new Error('crash');
    removed += 1;
    return realRemove(key, opts);
  };
  const crashed = await w.erase(A);
  assert.equal(crashed.status, 500);
  const marker = await w.store.get(erasedKey(A));
  assert.ok(marker.erased_at && !marker.quiet_until, 'erasing, not quiet');
  assert.ok(w.partition(A).length > 1, 'some items are left');

  // Long after, still refused: only a finished erase starts the quiet clock.
  w.tick(3 * QUIET_MS);
  assert.equal((await w.totals(A)).status, 409);
  assert.equal((await w.writeCall(A, 'POST /imports', { body: { source: 'csv', file_name: 'demo.csv', size: 10 } })).status, 409);
  assert.equal((await w.erase(A)).status, 500, 'still crashing');

  w.store.remove = realRemove;
  const done = await w.erase(A);
  assert.equal(done.status, 202);
  assert.deepEqual(done.body, { deleted: { items: items - 2, files: 1 } });
  assert.deepEqual(w.partition(A).map((i) => i.sk), ['ERASED']);
  const finished = await w.store.get(erasedKey(A));
  assert.equal(finished.erased_at, marker.erased_at, 'the same erase finished');
  assert.equal(finished.quiet_until, new Date(w.now() + QUIET_MS).toISOString());
});

test('T-ERA-3 resuming an unfinished erase waits for a lock taken before its mark, and keeps the marker', async () => {
  const w = world();
  await seed(w, A);
  // An erase that crashed right after its mark, while an import of a period held a live lock.
  const pointer = await w.store.get(perKey(A, 'csv', 'log'));
  await w.store.put({ ...pointer, lock_import: 'running', lock_until: new Date(T0 + LOCK_MS).toISOString(), rev: pointer.rev + 1 });
  await w.store.put({ ...erasedKey(A), erased_at: new Date(T0).toISOString() });
  const items = w.partition(A).length;
  const waiting = await w.erase(A);
  assert.deepEqual([waiting.status, waiting.body.error.code], [409, 'conflict']);
  assert.equal(w.partition(A).length, items, 'nothing deleted under a live lock');
  assert.deepEqual(await w.store.get(erasedKey(A)), { ...erasedKey(A), erased_at: new Date(T0).toISOString() }, 'the marker stays');
  w.tick(LOCK_MS + 1);
  assert.equal((await w.erase(A)).status, 202);
  assert.deepEqual(w.partition(A).map((i) => i.sk), ['ERASED']);
});

test('T-ERA-2 a form requested while an erase marks the person is refused by the write itself', async () => {
  const w = world();
  // The handler's own window check reads no marker; the erase marks the person right after.
  const realGet = w.store.get.bind(w.store);
  w.store.get = async (key, opts) => {
    if (key.sk === 'ERASED') {
      w.store.get = realGet;
      await w.store.put({ ...erasedKey(A), erased_at: new Date(T0).toISOString() });
      return undefined;
    }
    return realGet(key, opts);
  };
  const res = await w.writeCall(A, 'POST /imports', { body: { source: 'csv', file_name: 'demo.csv', size: 10 } });
  assert.deepEqual([res.status, res.body.error.code], [409, 'conflict']);
  assert.deepEqual(w.partition(A).map((i) => i.sk), ['ERASED'], 'no import record');
});

test('T-ERA-2 a refused erase whose marker another call took over answers conflict, not an error', async () => {
  const w = world();
  await seed(w, A);
  await w.upload(A, ['2026-05-01,Open,-1.00,ARS,acc'], { arrive: false });
  const realQuery = w.store.query.bind(w.store);
  w.store.query = async (q) => {
    w.store.query = realQuery;
    // A second erase resumes from this one's mark before it can put the marker back.
    await w.store.put({ ...erasedKey(A), erased_at: new Date(T0 + 1).toISOString() });
    return realQuery(q);
  };
  const res = await w.erase(A);
  assert.deepEqual([res.status, res.body.error.code], [409, 'conflict']);
  assert.equal((await w.store.get(erasedKey(A))).erased_at, new Date(T0 + 1).toISOString(), "the other call's marker is left alone");
});

test('T-ERA-2 a late undo reconcile whose lock expired, run once an erase has marked the person, writes no row and fails its record', async () => {
  const w = world();
  const first = await w.upload(A, ['2026-03-01,Old,-1.00,ARS,acc']);
  w.tick(MIN);
  await w.upload(A, ['2026-03-02,New,-2.00,ARS,acc']);
  const pointer = await w.store.get(perKey(A, 'csv', 'log'));
  const active = pointer.active_import;
  assert.notEqual(active, first.body.import_id);
  const undo = await w.writeCall(A, 'POST /imports/{id}/undo', { pathParameters: { id: active } });
  assert.equal(undo.status, 202);
  const [{ payload }] = w.store.invocations.filter((i) => i.functionName === 'parser-fn');
  const rowsBefore = w.partition(A).filter((i) => i.sk.startsWith('TXN#')).map((i) => i.sk);

  // The async invoke is delayed past the lock; an erase then marks the person and is about to list.
  w.tick(LOCK_MS + MIN);
  await w.store.put({ ...erasedKey(A), erased_at: new Date(w.now()).toISOString() });
  const out = await w.parser(payload);
  assert.equal(out.outcome, 'failed');
  assert.deepEqual(w.partition(A).filter((i) => i.sk.startsWith('TXN#')).map((i) => i.sk), rowsBefore, 'the undone file\'s rows are not put back');
  const after = await w.store.get(perKey(A, 'csv', 'log'));
  assert.equal(after.lock_import, undefined, 'the lock is not renewed');
  const record = await w.store.get(impKey(A, undo.body.import_id));
  assert.deepEqual([record.status, record.error?.code], ['failed', 'erasing']);
});

test('T-ROL-2 a rollup that meets a running erase writes nothing without failing; one that meets a refused erase\'s marker recomputes', async () => {
  const w = world();
  await w.upload(A, ['2026-03-01,Shop,-1.00,ARS,acc']);
  const month = { sub: A, months: 'all' };
  // Running: marked, no quiet_until yet. Not an error, so the erase's own deletions never alarm.
  await w.store.put({ ...erasedKey(A), erased_at: new Date(w.now()).toISOString() });
  assert.deepEqual(await w.rollup(month), { months: 1 });
  assert.equal(await w.store.get(sumKey(A, '2026-03')), undefined);

  // Refused: the marker is put back (here: removed) between the failed write and the re-read.
  const realGet = w.store.get.bind(w.store);
  w.store.get = async (key, opts) => {
    if (key.sk === 'ERASED') await w.store.remove(erasedKey(A));
    return realGet(key, opts);
  };
  assert.deepEqual(await w.rollup(month), { months: 1 });
  w.store.get = realGet;
  const total = await w.store.get(sumKey(A, '2026-03'));
  assert.equal(total.row_count, 1, 'the month is written once the marker is gone');

  // Quiet window: skipped, as before.
  await w.store.put({ ...erasedKey(A), erased_at: new Date(w.now()).toISOString(), quiet_until: new Date(w.now() + QUIET_MS).toISOString() });
  w.tick(MIN);
  await w.store.put({ ...total, computed_at: 0 });
  assert.deepEqual(await w.rollup(month), { months: 1 });
  assert.equal((await w.store.get(sumKey(A, '2026-03'))).computed_at, 0, 'nothing written in the window');
});
