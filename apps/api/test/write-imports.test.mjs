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

export const httpEvent = (sub, routeKey, { body, pathParameters } = {}) => ({
  routeKey,
  requestContext: sub == null ? {} : { authorizer: { jwt: { claims: { sub } } } },
  ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  ...(pathParameters ? { pathParameters } : {}),
});

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
