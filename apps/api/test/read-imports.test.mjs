// T-API-3: GET /imports and GET /imports/{id} against the in-memory store. Files are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES } from '@smart-finances/contracts/routes';
import { createMemoryStore } from '../src/store/memory.mjs';
import { createUlid } from '../src/store/ulid.mjs';
import { createImport, LOCK_MS, takeLock } from '../src/store/imports.mjs';
import { createParserHandler, objectCreated } from '../src/handlers/parser.mjs';
import { createReadHandler } from '../src/handlers/read.mjs';

const A = 'person-a';
const B = 'person-b';
const T0 = Date.parse('2026-11-01T12:00:00.000Z');
const MIN = 60_000;
const ev = (sub, routeKey, { pathParameters, queryStringParameters } = {}) => ({
  routeKey,
  requestContext: { authorizer: { jwt: { claims: { sub } } } },
  ...(pathParameters ? { pathParameters } : {}),
  ...(queryStringParameters ? { queryStringParameters } : {}),
});
const csv = (d) => `date,description,amount,currency,account\n2026-03-01,${d},-1.00,ARS,acc\n`;

function world() {
  const store = createMemoryStore();
  const ulid = createUlid();
  let clock = T0;
  const read = createReadHandler({ store, now: () => clock });
  const parser = createParserHandler({ store, now: () => clock });
  const get = async (sub, routeKey, opts) => {
    const res = await read(ev(sub, routeKey, opts));
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
  const make = async (sub, text, { deliver = true, source = 'csv', file_name = 'a.csv' } = {}) => {
    const r = await createImport(store, sub, { source, file_name, size: Buffer.byteLength(text), now: clock, ulid });
    store.putObject(r.s3_key, text);
    if (deliver) await parser(objectCreated(r.s3_key, new Date(clock).toISOString()));
    return r.import_id;
  };
  return { store, get, make, tick: (ms) => { clock += ms; }, now: () => clock };
}

test('T-API-3 GET /imports lists newest first with active, done, expired and stalled shown', async () => {
  const w = world();
  const old = await w.make(A, csv('A'));
  w.tick(MIN);
  const current = await w.make(A, csv('B'));
  w.tick(MIN);
  const neverArrived = await w.make(A, csv('C'), { deliver: false });
  w.tick(MIN);
  const stuck = await w.make(A, csv('D'), { deliver: false, source: 'mercadopago', file_name: 'may.csv' });
  await takeLock(w.store, A, stuck, { period: '2026-05', now: w.now() });
  w.tick(Math.max(LOCK_MS, 15 * MIN) + 1);

  const res = await w.get(A, 'GET /imports');
  assert.equal(res.status, 200);
  const parsed = ROUTES['GET /imports'].reply.safeParse(res.body);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  assert.deepEqual(res.body.items.map((i) => i.import_id), [stuck, neverArrived, current, old]);
  const by = Object.fromEntries(res.body.items.map((i) => [i.import_id, i]));
  assert.deepEqual([by[current].status, by[current].active], ['done', true]);
  assert.deepEqual([by[old].status, by[old].active], ['done', false]);
  assert.deepEqual([by[neverArrived].status, by[neverArrived].period, by[neverArrived].active], ['expired', '', false]);
  assert.deepEqual([by[stuck].status, by[stuck].period], ['stalled', '2026-05']);
  assert.deepEqual(by[current].counts, { added: 1, updated: 0, removed: 1, skipped: 0 });
  assert.equal(res.body.cursor, undefined);
  assert.ok(!JSON.stringify(res.body).includes('null'));
});

test('T-API-3 GET /imports pages hold 50 items, with an opaque cursor', async () => {
  const w = world();
  for (let i = 0; i < 53; i += 1) await w.make(A, csv(`R${i}`), { deliver: false });
  const first = await w.get(A, 'GET /imports');
  assert.equal(first.body.items.length, 50);
  assert.ok(first.body.cursor);
  const second = await w.get(A, 'GET /imports', { queryStringParameters: { cursor: first.body.cursor } });
  assert.equal(second.body.items.length, 3);
  assert.equal(second.body.cursor, undefined);
  assert.equal(new Set([...first.body.items, ...second.body.items].map((i) => i.import_id)).size, 53);
  const bad = await w.get(A, 'GET /imports', { queryStringParameters: { cursor: 'nonsense' } });
  assert.deepEqual([bad.status, bad.body.error.code], [400, 'bad_request']);
});

test('T-API-3 GET /imports/{id} returns the record, its skipped rows and error text, or not_found', async () => {
  const w = world();
  const ok = await w.make(A, 'date,description,amount,currency,account\n2026-03-01,A,-1.00,ARS,acc\n2026-13-01,B,-1.00,ARS,acc\n');
  const broken = await w.make(A, 'not a csv at all', { source: 'csv' });
  const one = await w.get(A, 'GET /imports/{id}', { pathParameters: { id: ok } });
  assert.equal(one.status, 200);
  const parsed = ROUTES['GET /imports/{id}'].reply.safeParse(one.body);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  assert.deepEqual([one.body.status, one.body.kind, one.body.active], ['done', 'file', true]);
  assert.deepEqual(one.body.skipped.map((s) => s.where), ['a.csv#row 2']);
  assert.equal(one.body.pk, undefined);
  const failed = await w.get(A, 'GET /imports/{id}', { pathParameters: { id: broken } });
  assert.ok(ROUTES['GET /imports/{id}'].reply.safeParse(failed.body).success);
  assert.equal(failed.body.status, 'failed');
  assert.equal(typeof failed.body.error, 'string');
  w.tick(16 * MIN);
  const late = await w.make(A, csv('Z'), { deliver: false });
  w.tick(16 * MIN);
  const expired = await w.get(A, 'GET /imports/{id}', { pathParameters: { id: late } });
  assert.deepEqual([expired.body.status, typeof expired.body.error], ['expired', 'string']);
  assert.match(expired.body.error, /never arrived/);
  assert.equal((await w.get(A, 'GET /imports/{id}', { pathParameters: { id: '01NOSUCH' } })).status, 404);
});

test('T-API-3 another person sees none of the imports', async () => {
  const w = world();
  const id = await w.make(A, csv('A'));
  assert.deepEqual((await w.get(B, 'GET /imports')).body, { items: [] });
  assert.equal((await w.get(B, 'GET /imports/{id}', { pathParameters: { id } })).status, 404);
});
