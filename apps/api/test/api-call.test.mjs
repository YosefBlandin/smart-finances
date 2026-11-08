// T-OPS-1: scripts/api-call.mjs builds the event API Gateway would hand a handler after the JWT
// authorizer, and picks the function that serves the route. Only the built event is checked; no
// test here calls AWS. Data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES } from '@smart-finances/contracts/routes';
import { buildCall, parseArgs, uploadRequest } from '../../../scripts/api-call.mjs';
import { createMemoryStore } from '../src/store/memory.mjs';
import { createReadHandler } from '../src/handlers/read.mjs';
import { createWriteHandler } from '../src/handlers/write.mjs';
import { createUlid } from '../src/store/ulid.mjs';

const SUB = 'test-person';

test('T-OPS-1 the event carries the sub in the JWT claims, the route key and the path and query values', () => {
  const { functionName, event } = buildCall({ stage: 'staging', sub: SUB, method: 'get', path: '/transactions?from=2026-05&to=2026-06&q=caf%C3%A9' });
  assert.equal(functionName, 'smart-finances-staging-api-read');
  assert.equal(event.version, '2.0');
  assert.equal(event.routeKey, 'GET /transactions');
  assert.equal(event.rawPath, '/transactions');
  assert.equal(event.rawQueryString, 'from=2026-05&to=2026-06&q=caf%C3%A9');
  assert.deepEqual(event.queryStringParameters, { from: '2026-05', to: '2026-06', q: 'café' });
  assert.deepEqual(event.requestContext.authorizer.jwt.claims, { sub: SUB });
  assert.deepEqual(event.requestContext.http, { method: 'GET', path: '/transactions' });
  assert.equal(event.pathParameters, undefined);
  assert.equal(event.body, undefined);
});

test('T-OPS-1 every route maps to its function: GET to api-read, DELETE to api-delete, the rest to api-write', () => {
  const sample = { '{id}': 'abc', '{source}': 'mercadopago', '{period}': '2026-05', '{month}': '2026-05' };
  const want = (key) => (key === 'GET /health' ? 'health' : key.startsWith('GET ') ? 'api-read' : key.startsWith('DELETE ') ? 'api-delete' : 'api-write');
  for (const key of Object.keys(ROUTES)) {
    const [method, template] = key.split(' ');
    const path = template.replace(/\{[a-z]+\}/g, (p) => sample[p]);
    const { functionName, event } = buildCall({ stage: 'qa', sub: SUB, method, path, yes: true });
    assert.equal(event.routeKey, key, path);
    assert.equal(functionName, `smart-finances-qa-${want(key)}`, key);
  }
  const repair = buildCall({ stage: 'qa', sub: SUB, method: 'POST', path: '/periods/mercadopago/2026-05/repair' }).event;
  assert.deepEqual(repair.pathParameters, { source: 'mercadopago', period: '2026-05' });
  const review = buildCall({ stage: 'qa', sub: SUB, method: 'PUT', path: '/transactions/a%20b/review', body: '{"date":"2026-05-02","approved":true}' }).event;
  assert.deepEqual(review.pathParameters, { id: 'a b' });
  assert.equal(review.body, '{"date":"2026-05-02","approved":true}');
});

test('T-OPS-1 refuses an unknown route, a bad stage, a missing sub and a body that is not JSON', () => {
  assert.throws(() => buildCall({ stage: 'qa', sub: SUB, method: 'GET', path: '/nope' }), /no route GET \/nope/);
  assert.throws(() => buildCall({ stage: 'qa', sub: SUB, method: 'PATCH', path: '/rates/2026-05' }), /no route PATCH/);
  assert.throws(() => buildCall({ stage: 'qa', sub: SUB, method: 'GET', path: '/imports/a/b' }), /no route/);
  assert.throws(() => buildCall({ stage: 'test', sub: SUB, method: 'GET', path: '/rates' }), /stage/);
  assert.throws(() => buildCall({ stage: 'dev', sub: SUB, method: 'GET', path: '/rates' }), /stage/);
  assert.throws(() => buildCall({ stage: 'qa', sub: '', method: 'GET', path: '/rates' }), /--as/);
  assert.throws(() => buildCall({ stage: 'qa', sub: SUB, method: 'PUT', path: '/rates/2026-05', body: '{nope' }), /JSON/);
});

test('T-OPS-1 never reaches prod: a forged claim there would skip sign-in for anyone allowed to invoke', () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    assert.throws(() => buildCall({ stage: 'prod', sub: SUB, method, path: method === 'PUT' ? '/rates/2026-05' : method === 'GET' ? '/rates' : '/data', body: method === 'GET' ? undefined : '{}', yes: true }), /--stage must be one of qa, staging/);
  }
  assert.throws(() => parseArgs(['--stage', 'prod', '--as', SUB, 'GET', '/rates']), /--stage must be one of qa, staging/);
});

test('T-OPS-1 DELETE /data needs --yes', () => {
  const del = { stage: 'staging', sub: SUB, method: 'DELETE', path: '/data', body: '{"confirm":"DELETE"}' };
  assert.throws(() => buildCall(del), /--yes/);
  assert.equal(buildCall({ ...del, yes: true }).functionName, 'smart-finances-staging-api-delete');
  assert.throws(() => parseArgs(['--stage', 'staging', '--as', SUB, 'DELETE', '/data', '{"confirm":"DELETE"}']), /--yes/);
  assert.equal(parseArgs(['--stage', 'staging', '--as', SUB, '--yes', 'DELETE', '/data', '{"confirm":"DELETE"}']).yes, true);
});

test('T-OPS-1 parses the command line', () => {
  assert.deepEqual(parseArgs(['--stage', 'staging', '--as', SUB, 'PUT', '/rates/2026-05', '{"ars_per_usd":1000}']), {
    stage: 'staging', sub: SUB, method: 'PUT', path: '/rates/2026-05', body: '{"ars_per_usd":1000}', upload: undefined, yes: false,
  });
  assert.deepEqual(parseArgs(['--as', SUB, '--stage', 'qa', '--upload', 'data/synthetic/transactions.csv']), {
    stage: 'qa', sub: SUB, method: 'POST', path: '/imports', body: undefined, upload: 'data/synthetic/transactions.csv', yes: false,
  });
  assert.throws(() => parseArgs(['--stage', 'qa', 'GET', '/rates']), /usage/);
  assert.throws(() => parseArgs(['--stage', 'qa', '--as', SUB, '--bogus', 'GET', '/rates']), /usage/);
});

test('T-OPS-1 --upload asks for a form for the file: its name, its size, csv unless the body names a source', () => {
  assert.deepEqual(JSON.parse(uploadRequest('dir/transactions.csv', 1234)), { source: 'csv', file_name: 'transactions.csv', size: 1234 });
  assert.deepEqual(JSON.parse(uploadRequest('may.csv', 10, '{"source":"mercadopago"}')), { source: 'mercadopago', file_name: 'may.csv', size: 10 });
});

test('T-OPS-1 the built events are ones the handlers answer as for that person', async () => {
  const store = createMemoryStore();
  const now = () => Date.parse('2026-11-01T12:00:00.000Z');
  const write = createWriteHandler({ store, now, ulid: createUlid(), parserFunction: 'parser-fn', rollupFunction: 'rollup-fn' });
  const read = createReadHandler({ store, now });
  const call = (handler, method, path, body) => handler(buildCall({ stage: 'qa', sub: SUB, method, path, body }).event);
  assert.equal((await call(write, 'PUT', '/rates/2026-05', '{"ars_per_usd":1000}')).statusCode, 200);
  const rates = await call(read, 'GET', '/rates');
  assert.deepEqual(JSON.parse(rates.body), { items: [{ month: '2026-05', ars_per_usd: 1000 }] });
  const keys = [...store.items.keys()];
  assert.ok(keys.length > 0 && keys.every((k) => k.includes(`U#${SUB}`)), 'written under the given sub only');
  const form = await call(write, 'POST', '/imports', uploadRequest('t.csv', 10));
  assert.equal(form.statusCode, 201);
  assert.match(JSON.parse(form.body).upload.fields.key, new RegExp(`^uploads/${SUB}/`));
});
