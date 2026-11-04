// T-WINF-8: the branch-variables custom resource (D-110, D-111). Runs with a fake Amplify client;
// no AWS call is made.
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { GetBranchCommand, UpdateBranchCommand } from '@aws-sdk/client-amplify';
import { makeHandler } from './amplify-vars.mjs';

const APP = 'dexampleapp00';
const OTHER = { NOT_OURS: 'kept', _CUSTOM_IMAGE: 'amplify:al2023', SOME_TOKEN: 'set-by-a-person' };

function notFound() {
  const error = new Error('Branch not found');
  error.name = 'NotFoundException';
  return error;
}

/** A fake Amplify client holding one branch's variables; records every command it is sent. */
function fakeAmplify(branches = { qa: { ...OTHER } }) {
  const calls = [];
  const state = structuredClone(branches);
  return {
    calls,
    state,
    async send(command) {
      calls.push(command);
      const { appId, branchName } = command.input;
      assert.equal(appId, APP);
      if (!(branchName in state)) throw notFound();
      if (command instanceof GetBranchCommand) {
        return { branch: { branchName, environmentVariables: { ...state[branchName] }, basicAuthCredentials: 'c2VjcmV0' } };
      }
      if (command instanceof UpdateBranchCommand) {
        assert.deepEqual(Object.keys(command.input).sort(), ['appId', 'branchName', 'environmentVariables']);
        state[branchName] = { ...command.input.environmentVariables };
        return { branch: { branchName } };
      }
      throw new Error(`unexpected command ${command.constructor.name}`);
    },
  };
}

const ours = {
  STAGE: 'qa',
  API_URL: 'https://api.example.test/',
  WEB_CLIENT_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:111111111111:secret:example-AbCdEf',
};

function event(RequestType, props, extra = {}) {
  return {
    RequestType,
    ServiceToken: 'arn:aws:lambda:us-east-1:111111111111:function:example',
    ResourceType: 'Custom::AmplifyBranchVariables',
    LogicalResourceId: 'AmplifyBranchVariables',
    StackId: 'arn:aws:cloudformation:us-east-1:111111111111:stack/example/0000',
    RequestId: 'req-1',
    ResourceProperties: { ServiceToken: 'arn:aws:lambda:us-east-1:111111111111:function:example', AppId: APP, BranchName: 'qa', Variables: ours, ...props },
    ...extra,
  };
}

test('T-WINF-8 create: gets the branch variables, merges ours in and puts them back without dropping any other key', async () => {
  const amplify = fakeAmplify();
  const out = await makeHandler({ amplify })(event('Create', {}));
  assert.deepEqual(
    amplify.calls.map((c) => c.constructor.name),
    ['GetBranchCommand', 'UpdateBranchCommand'],
  );
  assert.deepEqual(amplify.state.qa, { ...OTHER, ...ours });
  assert.deepEqual(out, { PhysicalResourceId: `amplify-vars/${APP}/qa` }, 'no Data: no variable reaches CloudFormation or a log');
});

test('T-WINF-8 create: an owned key someone changed by hand is set back; nothing is put when nothing changes', async () => {
  const amplify = fakeAmplify({ qa: { ...OTHER, STAGE: 'edited', API_URL: ours.API_URL, WEB_CLIENT_SECRET_ARN: ours.WEB_CLIENT_SECRET_ARN } });
  await makeHandler({ amplify })(event('Create', {}));
  assert.equal(amplify.state.qa.STAGE, 'qa');

  const again = fakeAmplify({ qa: { ...OTHER, ...ours } });
  await makeHandler({ amplify: again })(event('Create', {}));
  assert.deepEqual(again.calls.map((c) => c.constructor.name), ['GetBranchCommand'], 'already merged: no put');
});

test('T-WINF-8 update: removes only the keys it owned before and owns no longer; keeps every other key', async () => {
  const amplify = fakeAmplify({ qa: { ...OTHER, ...ours, OLD_SETTING: 'old' } });
  const next = { STAGE: 'qa', API_URL: 'https://api2.example.test/' };
  const out = await makeHandler({ amplify })(
    event('Update', { Variables: next }, {
      PhysicalResourceId: `amplify-vars/${APP}/qa`,
      OldResourceProperties: { AppId: APP, BranchName: 'qa', Variables: { ...ours, OLD_SETTING: 'old' } },
    }),
  );
  assert.deepEqual(amplify.state.qa, { ...OTHER, ...next });
  assert.deepEqual(out, { PhysicalResourceId: `amplify-vars/${APP}/qa` });
});

test('T-WINF-8 update to another branch: sets the new branch only and returns a new id, so the old one is cleaned on delete', async () => {
  const amplify = fakeAmplify({ qa: { ...OTHER, ...ours }, main: { NOT_OURS: 'kept', STAGE: 'x' } });
  const out = await makeHandler({ amplify })(
    event('Update', { BranchName: 'main' }, {
      PhysicalResourceId: `amplify-vars/${APP}/qa`,
      OldResourceProperties: { AppId: APP, BranchName: 'qa', Variables: ours },
    }),
  );
  assert.deepEqual(amplify.state.main, { NOT_OURS: 'kept', ...ours });
  assert.deepEqual(amplify.state.qa, { ...OTHER, ...ours }, 'the old branch is left for the delete event');
  assert.deepEqual(out, { PhysicalResourceId: `amplify-vars/${APP}/main` });
});

test('T-WINF-8 delete: removes only the keys it owns; a missing branch is already done', async () => {
  const amplify = fakeAmplify({ qa: { ...OTHER, ...ours } });
  const out = await makeHandler({ amplify })(event('Delete', {}, { PhysicalResourceId: `amplify-vars/${APP}/qa` }));
  assert.deepEqual(amplify.state.qa, OTHER);
  assert.deepEqual(out, { PhysicalResourceId: `amplify-vars/${APP}/qa` });

  const gone = fakeAmplify({});
  const out2 = await makeHandler({ amplify: gone })(event('Delete', {}, { PhysicalResourceId: `amplify-vars/${APP}/qa` }));
  assert.deepEqual(gone.calls.map((c) => c.constructor.name), ['GetBranchCommand']);
  assert.deepEqual(out2, { PhysicalResourceId: `amplify-vars/${APP}/qa` });
});

test('T-WINF-8 create or update on a missing branch fails the deploy', async () => {
  const amplify = fakeAmplify({});
  await assert.rejects(makeHandler({ amplify })(event('Create', {})), { name: 'NotFoundException' });
});

test('T-WINF-8 no secret value: a secret-like name must be an _ARN, refused before any call', async () => {
  for (const name of ['WEB_CLIENT_SECRET', 'HMAC_SECRET', 'API_TOKEN', 'DB_PASSWORD', 'PRIVATE_KEY', 'CREDENTIALS', 'client_secret']) {
    const amplify = fakeAmplify();
    await assert.rejects(makeHandler({ amplify })(event('Create', { Variables: { ...ours, [name]: 'x' } })), /secret|name/i, name);
    assert.equal(amplify.calls.length, 0, `${name}: nothing sent`);
  }
  for (const name of ['WEB_CLIENT_SECRET_ARN', 'HMAC_SECRET_ARN']) {
    const amplify = fakeAmplify();
    await makeHandler({ amplify })(event('Create', { Variables: { [name]: 'arn:aws:secretsmanager:us-east-1:111111111111:secret:x' } }));
    assert.equal(amplify.calls.length, 2, `${name} is allowed`);
  }
});

test('T-WINF-8 refuses a value that is not a string, a bad name, no variables or a missing app or branch', async () => {
  const bad = [
    { Variables: { STAGE: 1 } },
    { Variables: { 'bad-name': 'x' } },
    { Variables: {} },
    { Variables: undefined },
    { AppId: '' },
    { BranchName: undefined },
  ];
  for (const props of bad) {
    const amplify = fakeAmplify();
    await assert.rejects(makeHandler({ amplify })(event('Create', props)), Error, JSON.stringify(props));
    assert.equal(amplify.calls.length, 0);
  }
  await assert.rejects(makeHandler({ amplify: fakeAmplify() })(event('Bogus', {})), /RequestType/);
});

test('T-WINF-8 logs nothing: the branch variables may hold values set by people', async (t) => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) => t.mock.method(console, m, () => {}));
  const amplify = fakeAmplify();
  await makeHandler({ amplify })(event('Create', {}));
  await makeHandler({ amplify })(event('Delete', {}, { PhysicalResourceId: `amplify-vars/${APP}/qa` }));
  for (const spy of spies) assert.equal(spy.mock.callCount(), 0);
});
