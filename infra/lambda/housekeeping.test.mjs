// T-WINF-10, T-WINF-11: the hourly housekeeping function (D-104, D-106, D-107). Runs with fake
// Cognito, DynamoDB, Lambda and SSM clients and a fake fetch; no AWS call is made.
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { makeHandler, DELETE_FUNCTION_NOT_SET } from './housekeeping.mjs';

// Synthetic values only: fake pool and table names, example.test addresses, made-up subs.
const NOW = Date.parse('2026-11-04T12:00:00.000Z');
const HOUR = 3_600_000;
const CONFIG = {
  stage: 'qa',
  userPoolId: 'us-east-1_FAKEPOOL0',
  sessionsTable: 'fake-sessions-table',
  accountsTable: 'fake-accounts-table',
  healthUrl: 'https://qa.dexampleapp00.amplifyapp.com/api/health',
  deleteFunctionParameter: '/smart-finances/qa/delete-function-name',
};
const DELETE_FN = 'smart-finances-qa-api-delete';
const SUB_A = '00000000-0000-4000-8000-00000000000a';
const SUB_B = '00000000-0000-4000-8000-00000000000b';

const named = (name, message = name) => Object.assign(new Error(message), { name });
const ago = (hours) => new Date(NOW - hours * HOUR);
const iso = (hours) => ago(hours).toISOString();

/**
 * One fake for every client: records each command as [client, command name, input] and answers
 * from the state below. Errors can be injected per command name (and per sub or username).
 */
// deleteFunction: the parameter's value, or null when the parameter does not exist.
function world({ users = [], accounts = [], sessions = [], deleteFunction = DELETE_FN, fail = {}, invokeAnswer } = {}) {
  const calls = [];
  const state = {
    users: users.map((u) => ({ ...u })),
    accounts: accounts.map((a) => ({ ...a })),
    sessions: sessions.map((s) => ({ ...s })),
  };
  const failure = (name, key) => {
    const f = fail[name];
    if (!f) return undefined;
    if (typeof f === 'function') return f(key);
    return f;
  };
  let listed;
  const client = (kind, answer) => ({
    async send(command) {
      const name = command.constructor.name;
      calls.push([kind, name, structuredClone(command.input)]);
      return answer(name, command.input);
    },
  });

  const cognito = client('cognito', (name, input) => {
    assert.equal(input.UserPoolId, CONFIG.userPoolId, 'this pool only');
    if (name === 'ListUsersCommand') {
      // The fake ignores the filter on purpose: the handler must check the status itself too.
      const pageSize = 2;
      const start = input.PaginationToken ? Number(input.PaginationToken) : 0;
      // Pages over the users as they were at the first call, like a stable pagination token.
      listed ??= [...state.users];
      const page = listed.slice(start, start + pageSize).map((u) => ({
        Username: u.username,
        UserStatus: u.status,
        UserCreateDate: u.created,
        Enabled: true,
        Attributes: [
          { Name: 'sub', Value: u.username },
          { Name: 'email', Value: u.email },
        ],
      }));
      const next = start + pageSize < listed.length ? String(start + pageSize) : undefined;
      return { Users: page, PaginationToken: next };
    }
    const error = failure(name, input.Username);
    if (error) throw error;
    if (name === 'AdminDeleteUserCommand' || name === 'AdminUserGlobalSignOutCommand') {
      const i = state.users.findIndex((u) => u.username === input.Username);
      if (i < 0) throw named('UserNotFoundException', 'User does not exist.');
      if (name === 'AdminDeleteUserCommand') state.users.splice(i, 1);
      return {};
    }
    throw new Error(`unexpected cognito command ${name}`);
  });

  const dynamodb = client('dynamodb', (name, input) => {
    const error = failure(name, input.Key?.pk?.S ?? input.TableName);
    if (error) throw error;
    if (name === 'ScanCommand') {
      assert.equal(input.TableName, CONFIG.accountsTable, 'only the accounts table is scanned');
      // One row per page, so the handler has to follow LastEvaluatedKey.
      const deleting = state.accounts.filter((a) => a.status === 'deleting');
      const start = input.ExclusiveStartKey ? Number(input.ExclusiveStartKey.pk.S.split('#')[1]) : 0;
      const row = deleting[start];
      const items = row
        ? [{ pk: { S: row.pk }, status: { S: row.status }, ...(row.deleting_since ? { deleting_since: { S: row.deleting_since } } : {}) }]
        : [];
      const last = start + 1 < deleting.length ? { pk: { S: `PAGE#${start + 1}` } } : undefined;
      return { Items: items, LastEvaluatedKey: last };
    }
    if (name === 'QueryCommand') {
      assert.equal(input.TableName, CONFIG.sessionsTable);
      assert.equal(input.IndexName, 'bySub');
      const sub = Object.values(input.ExpressionAttributeValues)[0].S;
      return { Items: state.sessions.filter((s) => s.sub === sub).map((s) => ({ pk: { S: s.pk }, sub: { S: s.sub } })) };
    }
    if (name === 'DeleteItemCommand') {
      const pk = input.Key.pk.S;
      if (input.TableName === CONFIG.sessionsTable) {
        state.sessions = state.sessions.filter((s) => s.pk !== pk);
        return {};
      }
      assert.equal(input.TableName, CONFIG.accountsTable);
      const row = state.accounts.find((a) => a.pk === pk);
      if (!row || row.status !== input.ExpressionAttributeValues?.[':deleting']?.S) {
        throw named('ConditionalCheckFailedException', 'The conditional request failed');
      }
      state.accounts = state.accounts.filter((a) => a.pk !== pk);
      return {};
    }
    throw new Error(`unexpected dynamodb command ${name}`);
  });

  const lambda = client('lambda', (name, input) => {
    assert.equal(name, 'InvokeCommand');
    const sub = JSON.parse(Buffer.from(input.Payload).toString('utf8')).sub;
    const error = failure(name, sub);
    if (error) throw error;
    if (invokeAnswer) return invokeAnswer(sub);
    return { StatusCode: 200, Payload: Buffer.from(JSON.stringify({ erased: true })) };
  });

  const ssm = client('ssm', (name, input) => {
    assert.equal(name, 'GetParameterCommand');
    assert.equal(input.Name, CONFIG.deleteFunctionParameter);
    if (deleteFunction === null) throw named('ParameterNotFound');
    return { Parameter: { Name: input.Name, Value: deleteFunction } };
  });

  const fetches = [];
  let health = { status: 200 };
  const fetch = async (url, init) => {
    fetches.push([url, init?.method ?? 'GET']);
    if (health instanceof Error) throw health;
    return { status: health.status, ok: health.status >= 200 && health.status < 300, text: async () => '{"sha":"0000000","stage":"qa"}' };
  };

  const lines = [];
  const run = (overrides = {}) =>
    makeHandler({ cognito, dynamodb, lambda, ssm, fetch, now: () => NOW, log: (line) => lines.push(line), config: CONFIG, ...overrides })({});

  return {
    calls,
    state,
    fetches,
    lines,
    run,
    setHealth: (h) => {
      health = h;
    },
    names: (kind) => calls.filter(([k]) => k === kind).map(([, n, input]) => [n, input]),
  };
}

/** The Embedded Metric Format line for StuckDeletions, parsed. */
function stuckMetric(lines) {
  const metrics = lines.map((l) => JSON.parse(l)).filter((l) => l._aws);
  assert.equal(metrics.length, 1, 'one metric line per run');
  return metrics[0];
}

function assertNoPersonalData(w) {
  for (const line of w.lines) {
    assert.ok(!line.includes('@'), `no email in ${line}`);
    assert.ok(!line.includes(SUB_A) && !line.includes(SUB_B), `no sub in ${line}`);
    assert.ok(!/user-(old|young|edge|confirmed)/.test(line), `no username in ${line}`);
  }
}

// ---------------------------------------------------------------- T-WINF-10

test('T-WINF-10 removes unconfirmed users older than 24 hours only, across pages', async () => {
  const w = world({
    users: [
      { username: 'user-old', status: 'UNCONFIRMED', created: ago(25), email: 'old@example.test' },
      { username: 'user-young', status: 'UNCONFIRMED', created: ago(23), email: 'young@example.test' },
      { username: 'user-edge', status: 'UNCONFIRMED', created: ago(24), email: 'edge@example.test' },
      { username: 'user-confirmed', status: 'CONFIRMED', created: ago(100), email: 'confirmed@example.test' },
      { username: 'user-old-2', status: 'UNCONFIRMED', created: ago(48), email: 'old2@example.test' },
    ],
  });
  const result = await w.run();

  const lists = w.names('cognito').filter(([n]) => n === 'ListUsersCommand');
  assert.equal(lists.length, 3, 'follows PaginationToken to the last page');
  for (const [, input] of lists) {
    assert.equal(input.Filter, 'cognito:user_status = "UNCONFIRMED"');
    assert.deepEqual(input.AttributesToGet, ['sub'], 'no email is fetched');
  }
  assert.deepEqual(lists.map(([, i]) => i.PaginationToken), [undefined, '2', '4']);

  const deleted = w.names('cognito').filter(([n]) => n === 'AdminDeleteUserCommand').map(([, i]) => i.Username);
  assert.deepEqual(deleted, ['user-old', 'user-old-2'], 'only unconfirmed and strictly older than 24 hours');
  assert.deepEqual(w.state.users.map((u) => u.username), ['user-young', 'user-edge', 'user-confirmed']);
  assert.equal(result.unconfirmedRemoved, 2);
  // No sign-out for an unconfirmed user: there is nothing to sign out.
  assert.equal(w.names('cognito').filter(([n]) => n === 'AdminUserGlobalSignOutCommand').length, 0);
  assertNoPersonalData(w);
});

test('T-WINF-10 an unconfirmed user already gone counts as removed; another failure does not stop the rest and fails the run', async () => {
  const w = world({
    users: [
      { username: 'user-old', status: 'UNCONFIRMED', created: ago(30), email: 'old@example.test' },
      { username: 'user-old-2', status: 'UNCONFIRMED', created: ago(30), email: 'old2@example.test' },
      { username: 'user-old-3', status: 'UNCONFIRMED', created: ago(30), email: 'old3@example.test' },
    ],
    fail: {
      AdminDeleteUserCommand: (username) =>
        username === 'user-old' ? named('UserNotFoundException') : username === 'user-old-2' ? named('TooManyRequestsException') : undefined,
    },
  });
  await assert.rejects(w.run(), /housekeeping: 1 step\(s\) failed/);
  const deleted = w.names('cognito').filter(([n]) => n === 'AdminDeleteUserCommand').map(([, i]) => i.Username);
  assert.deepEqual(deleted, ['user-old', 'user-old-2', 'user-old-3'], 'every candidate is tried');
  // The heartbeat still ran and the summary was logged before the run failed.
  assert.equal(w.fetches.length, 1);
  const summary = w.lines.map((l) => JSON.parse(l)).find((l) => l.event === 'housekeeping');
  assert.equal(summary.unconfirmedRemoved, 2);
  assert.deepEqual(summary.failures, [{ step: 'remove_unconfirmed', error: 'TooManyRequestsException' }]);
  assertNoPersonalData(w);
});

// ---------------------------------------------------------------- T-WINF-11

test('T-WINF-11 finishes a deletion step by step: erase through the delete function, sign out, delete the user, remove the rows', async () => {
  const w = world({
    users: [{ username: SUB_A, status: 'CONFIRMED', created: ago(500), email: 'a@example.test' }],
    accounts: [
      { pk: `ACCT#${SUB_A}`, status: 'deleting', deleting_since: iso(1) },
      { pk: `ACCT#${SUB_B}`, status: 'active' },
    ],
    sessions: [
      { pk: 'SID#aaaa', sub: SUB_A },
      { pk: 'SID#bbbb', sub: SUB_A },
      { pk: 'SID#cccc', sub: SUB_B },
    ],
  });
  const result = await w.run();

  // The deleting row's steps, in D-104's order, after reading the parameter once.
  const steps = w.calls
    .filter(([k, n]) => !(k === 'cognito' && n === 'ListUsersCommand') && n !== 'ScanCommand')
    .map(([k, n, input]) => {
      if (n === 'InvokeCommand') return `${n} ${input.FunctionName} ${input.InvocationType} ${Buffer.from(input.Payload).toString('utf8')}`;
      if (n === 'DeleteItemCommand') return `${n} ${input.TableName} ${input.Key.pk.S}`;
      if (n === 'QueryCommand') return `${n} ${input.IndexName}`;
      if (k === 'cognito') return `${n} ${input.Username}`;
      return `${n} ${input.Name}`;
    });
  assert.deepEqual(steps, [
    `GetParameterCommand ${CONFIG.deleteFunctionParameter}`,
    `InvokeCommand ${DELETE_FN} RequestResponse {"sub":"${SUB_A}"}`,
    `AdminUserGlobalSignOutCommand ${SUB_A}`,
    `AdminDeleteUserCommand ${SUB_A}`,
    'QueryCommand bySub',
    'DeleteItemCommand fake-sessions-table SID#aaaa',
    'DeleteItemCommand fake-sessions-table SID#bbbb',
    `DeleteItemCommand fake-accounts-table ACCT#${SUB_A}`,
  ]);

  // The accounts row goes last and only while it is still deleting.
  const accountDelete = w.names('dynamodb').find(([n, i]) => n === 'DeleteItemCommand' && i.TableName === CONFIG.accountsTable)[1];
  assert.ok(accountDelete.ConditionExpression.includes(':deleting'));
  assert.deepEqual(accountDelete.ExpressionAttributeValues[':deleting'], { S: 'deleting' });

  // Only deleting rows are read.
  const scan = w.names('dynamodb').find(([n]) => n === 'ScanCommand')[1];
  assert.deepEqual(Object.values(scan.ExpressionAttributeValues), [{ S: 'deleting' }]);

  assert.deepEqual(w.state.users, []);
  assert.deepEqual(w.state.accounts.map((a) => a.pk), [`ACCT#${SUB_B}`]);
  assert.deepEqual(w.state.sessions.map((s) => s.pk), ['SID#cccc'], "another person's session stays");
  assert.equal(result.deletionsFinished, 1);
  assert.equal(result.stuckDeletions, 0);
  assert.equal(stuckMetric(w.lines).StuckDeletions, 0, 'the metric is put every run, also when zero');
  assertNoPersonalData(w);
});

test('T-WINF-11 a pool user or rows already gone count as done; each step is safe to repeat', async () => {
  const w = world({
    users: [],
    accounts: [{ pk: `ACCT#${SUB_A}`, status: 'deleting', deleting_since: iso(8) }],
    sessions: [],
  });
  const result = await w.run();
  assert.equal(result.deletionsFinished, 1);
  assert.equal(result.stuckDeletions, 0, 'finished this run, so not stuck');
  assert.deepEqual(w.state.accounts, []);

  // The row changed under us (no longer deleting): the conditional delete fails, which is done too.
  const w2 = world({
    users: [{ username: SUB_A, status: 'CONFIRMED', created: ago(500), email: 'a@example.test' }],
    accounts: [{ pk: `ACCT#${SUB_A}`, status: 'deleting', deleting_since: iso(2) }],
    fail: { DeleteItemCommand: (pk) => (pk === `ACCT#${SUB_A}` ? named('ConditionalCheckFailedException') : undefined) },
  });
  const r2 = await w2.run();
  assert.equal(r2.deletionsFinished, 1);
  assert.deepEqual(r2.failures, []);
});

test('T-WINF-11 a failed erase stops that deletion before any later step; over 6 hours it is stuck; the run fails after the metric and the heartbeat', async () => {
  const w = world({
    users: [
      { username: SUB_A, status: 'CONFIRMED', created: ago(500), email: 'a@example.test' },
      { username: SUB_B, status: 'CONFIRMED', created: ago(500), email: 'b@example.test' },
    ],
    accounts: [
      { pk: `ACCT#${SUB_A}`, status: 'deleting', deleting_since: iso(7) },
      { pk: `ACCT#${SUB_B}`, status: 'deleting', deleting_since: iso(7) },
    ],
    sessions: [{ pk: 'SID#aaaa', sub: SUB_A }],
    invokeAnswer: (sub) =>
      sub === SUB_A
        ? { StatusCode: 200, FunctionError: 'Unhandled', Payload: Buffer.from('{"errorMessage":"boom"}') }
        : { StatusCode: 200, Payload: Buffer.from('{}') },
  });
  await assert.rejects(w.run(), /housekeeping: 1 step\(s\) failed/);

  const forA = w.calls.filter(([, n, i]) => i.Username === SUB_A || i.Key?.pk?.S?.endsWith(SUB_A) || i.Key?.pk?.S === 'SID#aaaa');
  assert.deepEqual(forA, [], 'no sign-out, user delete or row removal after a failed erase');
  assert.deepEqual(w.state.sessions.map((s) => s.pk), ['SID#aaaa']);
  assert.ok(w.state.accounts.some((a) => a.pk === `ACCT#${SUB_A}`), 'the row stays deleting');
  assert.ok(!w.state.accounts.some((a) => a.pk === `ACCT#${SUB_B}`), 'the next deletion is still finished');

  const metric = stuckMetric(w.lines);
  assert.equal(metric.StuckDeletions, 1);
  assert.deepEqual(metric._aws.CloudWatchMetrics, [
    { Namespace: 'SmartFinances/qa', Dimensions: [[]], Metrics: [{ Name: 'StuckDeletions', Unit: 'Count' }] },
  ]);
  assert.equal(metric._aws.Timestamp, NOW);
  assert.equal(w.fetches.length, 1, 'the heartbeat still runs');
  const summary = w.lines.map((l) => JSON.parse(l)).find((l) => l.event === 'housekeeping');
  assert.deepEqual(summary.failures, [{ step: 'erase', error: 'Unhandled' }]);
  assertNoPersonalData(w);
});

test('T-WINF-11 a deletion that fails for under 6 hours is not stuck yet; a row without deleting_since counts as stuck', async () => {
  const w = world({
    users: [{ username: SUB_A, status: 'CONFIRMED', created: ago(500), email: 'a@example.test' }],
    accounts: [
      { pk: `ACCT#${SUB_A}`, status: 'deleting', deleting_since: iso(5.9) },
      { pk: `ACCT#${SUB_B}`, status: 'deleting' },
    ],
    fail: { AdminUserGlobalSignOutCommand: () => named('InternalErrorException') },
  });
  await assert.rejects(w.run(), /housekeeping: 2 step\(s\) failed/);
  // Both fail at the sign-out; only the row with no age counts as stuck.
  assert.equal(stuckMetric(w.lines).StuckDeletions, 1);
  const deletedUsers = w.names('cognito').filter(([n]) => n === 'AdminDeleteUserCommand');
  assert.deepEqual(deletedUsers, [], 'the user is not deleted after a failed sign-out');
});

test('T-WINF-11 without delete-function-name the erase is skipped and counted; nothing of that person is removed', async () => {
  const w = world({
    deleteFunction: null,
    users: [{ username: SUB_A, status: 'CONFIRMED', created: ago(500), email: 'a@example.test' }],
    accounts: [
      { pk: `ACCT#${SUB_A}`, status: 'deleting', deleting_since: iso(7) },
      { pk: `ACCT#${SUB_B}`, status: 'deleting', deleting_since: iso(1) },
    ],
    sessions: [{ pk: 'SID#aaaa', sub: SUB_A }],
  });
  const result = await w.run();
  assert.equal(result.eraseSkipped, 2);
  assert.equal(result.deletionsFinished, 0);
  assert.deepEqual(w.names('lambda'), [], 'no function is invoked');
  assert.deepEqual(
    w.calls.filter(([k, n]) => (k === 'cognito' && n !== 'ListUsersCommand') || n === 'QueryCommand' || n === 'DeleteItemCommand'),
    [],
    'no sign-out, user delete or row removal while the data cannot be erased',
  );
  assert.equal(w.names('ssm').length, 1, 'the parameter is read once per run');
  assert.equal(stuckMetric(w.lines).StuckDeletions, 1, 'the one deleting over 6 hours alarms');
  const summary = w.lines.map((l) => JSON.parse(l)).find((l) => l.event === 'housekeeping');
  assert.equal(summary.eraseSkipped, 2);
  assert.equal(summary.deleteFunction, DELETE_FUNCTION_NOT_SET);
  assertNoPersonalData(w);
});

test('T-WINF-11 an empty delete-function-name counts as missing; another SSM error fails the run but not the rest', async () => {
  const w = world({ deleteFunction: '  ', accounts: [{ pk: `ACCT#${SUB_A}`, status: 'deleting', deleting_since: iso(1) }] });
  const r = await w.run();
  assert.equal(r.eraseSkipped, 1);
  assert.deepEqual(w.names('lambda'), []);

  const w2 = world({
    users: [{ username: 'user-old', status: 'UNCONFIRMED', created: ago(30), email: 'old@example.test' }],
    accounts: [{ pk: `ACCT#${SUB_A}`, status: 'deleting', deleting_since: iso(1) }],
  });
  const ssm = { send: async () => Promise.reject(named('AccessDeniedException')) };
  await assert.rejects(w2.run({ ssm }), /housekeeping: 1 step\(s\) failed/);
  assert.deepEqual(w2.state.users, [], 'unconfirmed users are still removed');
  assert.deepEqual(w2.names('lambda'), [], 'no invoke without a known function');
  assert.equal(w2.fetches.length, 1);
});

test('T-WINF-11 calls the branch /api/health once per run; a failed or refused health call fails the run after the rest', async () => {
  const w = world({ users: [{ username: 'user-old', status: 'UNCONFIRMED', created: ago(30), email: 'old@example.test' }] });
  await w.run();
  assert.deepEqual(w.fetches, [[CONFIG.healthUrl, 'GET']]);
  const summary = w.lines.map((l) => JSON.parse(l)).find((l) => l.event === 'housekeeping');
  assert.equal(summary.health, 200);

  const w2 = world({ users: [{ username: 'user-old', status: 'UNCONFIRMED', created: ago(30), email: 'old@example.test' }] });
  w2.setHealth({ status: 503 });
  await assert.rejects(w2.run(), /housekeeping: 1 step\(s\) failed/);
  assert.deepEqual(w2.state.users, [], 'the other work was done first');
  assert.equal(w2.fetches.length, 1, 'no retry inside the run');

  const w3 = world();
  w3.setHealth(named('TimeoutError', 'The operation was aborted due to timeout'));
  await assert.rejects(w3.run(), /housekeeping: 1 step\(s\) failed/);
  const s3 = w3.lines.map((l) => JSON.parse(l)).find((l) => l.event === 'housekeeping');
  assert.deepEqual(s3.failures, [{ step: 'health', error: 'TimeoutError' }]);
});

test('T-WINF-10 T-WINF-11 a failed listing or scan is recorded and the other half still runs', async () => {
  const w = world({
    users: [{ username: 'user-old', status: 'UNCONFIRMED', created: ago(30), email: 'old@example.test' }],
    accounts: [{ pk: `ACCT#${SUB_A}`, status: 'deleting', deleting_since: iso(1) }],
    fail: { ScanCommand: () => named('ProvisionedThroughputExceededException') },
  });
  await assert.rejects(w.run(), /housekeeping: 1 step\(s\) failed/);
  assert.deepEqual(w.state.users, []);
  assert.equal(w.fetches.length, 1);
  // The stuck count is unknown when the scan fails: no metric value is invented.
  assert.equal(w.lines.map((l) => JSON.parse(l)).filter((l) => l._aws).length, 0);
});
