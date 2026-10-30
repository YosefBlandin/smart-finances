import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, fail, personOf, reply } from '../src/handlers/http.mjs';

const event = (claims, extra = {}) => ({
  requestContext: claims === undefined ? {} : { authorizer: { jwt: { claims } } },
  ...extra,
});

// A caller trying to name someone else's partition in every place a request can carry data.
const hostile = {
  pathParameters: { sub: 'someone-else', id: 'someone-else' },
  queryStringParameters: { sub: 'someone-else', person: 'someone-else' },
  body: JSON.stringify({ sub: 'someone-else', person: 'someone-else' }),
  headers: { 'x-sub': 'someone-else' },
};

test('T-AUTH-1 personOf returns the verified claims sub and nothing from the request', () => {
  assert.equal(personOf(event({ sub: 'sub-a' })), 'sub-a');
  assert.equal(personOf(event({ sub: 'sub-a' }, hostile)), 'sub-a');

  for (const claims of [undefined, {}, { sub: '' }, { sub: '   ' }, { sub: 42 }, { 'cognito:username': 'sub-a' }]) {
    for (const extra of [{}, hostile]) {
      assert.throws(
        () => personOf(event(claims, extra)),
        (err) => err instanceof HttpError && err.code === 'unauthorized' && err.status === 401,
      );
    }
  }
  assert.throws(() => personOf({}), HttpError);
  assert.throws(() => personOf(undefined), HttpError);
});

test('T-AUTH-2 reply and fail map each error code to its status and the error body', () => {
  assert.deepEqual(reply(200, { ok: true }), {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: '{"ok":true}',
  });

  const statuses = {
    unauthorized: 401,
    bad_request: 400,
    not_found: 404,
    conflict: 409,
    source_file_only: 409,
    too_large: 413,
  };
  for (const [code, status] of Object.entries(statuses)) {
    const err = new HttpError(code, `message for ${code}`);
    assert.equal(err.status, status);
    assert.deepEqual(fail(err), {
      statusCode: status,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: { code, message: `message for ${code}` } }),
    });
  }
  for (const unknown of ['teapot', 'toString', 'constructor', '__proto__']) {
    assert.throws(() => new HttpError(unknown, 'x'), /unknown error code/);
  }

  // Anything else is a 500 with no detail, so internals never reach the caller.
  const internal = fail(new Error('table name and key U#sub-a leaked'));
  assert.equal(internal.statusCode, 500);
  assert.deepEqual(internal.headers, { 'content-type': 'application/json' });
  assert.deepEqual(JSON.parse(internal.body), { error: { code: 'internal', message: 'internal error' } });
  assert.equal(fail('a string').statusCode, 500);
});
