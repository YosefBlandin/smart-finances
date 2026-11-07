import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { makeHandler, REASONS } from './pre-sign-up.mjs';

// Synthetic values only: obviously fake client ids and example.test addresses.
const STAGE = 'qa';
const WEB_CLIENT = 'fakewebserverclient000000';
const OTHER_CLIENT = 'fakepublicclient0000000000';
const NAMES = { client: `/smart-finances/${STAGE}/web-client-id`, open: `/smart-finances/${STAGE}/signup-open` };

// A stand-in for the SSM client: answers GetParameters from a map and counts the calls.
function fakeSsm(values) {
  const calls = [];
  return {
    calls,
    async send(command) {
      calls.push(command);
      assert.equal(command.constructor.name, 'GetParametersCommand');
      const names = command.input.Names;
      return {
        Parameters: names.filter((n) => values[n] !== undefined).map((n) => ({ Name: n, Value: values[n] })),
        InvalidParameters: names.filter((n) => values[n] === undefined),
      };
    },
  };
}

// Overrides are spread over the defaults, so an explicit undefined removes a value.
function event(overrides = {}) {
  const { clientId, email, triggerSource } = { clientId: WEB_CLIENT, email: 'person@example.test', triggerSource: 'PreSignUp_SignUp', ...overrides };
  return {
    version: '1',
    triggerSource,
    region: 'us-east-1',
    userPoolId: 'us-east-1_FAKEPOOL0',
    userName: '00000000-0000-4000-8000-000000000000',
    callerContext: { awsSdkVersion: 'aws-sdk-unknown-unknown', clientId },
    request: { userAttributes: { email } },
    response: { autoConfirmUser: false, autoVerifyEmail: false, autoVerifyPhone: false },
  };
}

const open = { [NAMES.client]: WEB_CLIENT, [NAMES.open]: 'true' };

async function refusal(promise) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof Error);
    return true;
  });
  return promise.catch((err) => err.message);
}

test('T-WINF-3 accepts a sign-up from the web-server client with signup-open "true" and an ordinary domain, unchanged', async () => {
  const handler = makeHandler({ ssm: fakeSsm(open), stage: STAGE });
  const input = event();
  const out = await handler(input);
  assert.deepEqual(out, event(), 'the event comes back as it was: no auto-confirm, no auto-verify');
});

test('T-WINF-3 refuses another client with the reason key client_not_allowed', async () => {
  const handler = makeHandler({ ssm: fakeSsm(open), stage: STAGE });
  assert.equal(await refusal(handler(event({ clientId: OTHER_CLIENT }))), REASONS.client);
  assert.equal(REASONS.client, 'client_not_allowed');
  assert.equal(await refusal(handler(event({ clientId: undefined }))), REASONS.client, 'no client id at all (admin create user)');
});

test('T-WINF-3 refuses when web-client-id is missing, so no client is allowed', async () => {
  const handler = makeHandler({ ssm: fakeSsm({ [NAMES.open]: 'true' }), stage: STAGE });
  assert.equal(await refusal(handler(event())), REASONS.client);
});

test('T-WINF-3 refuses when signup-open is not "true": false, missing, other spellings', async () => {
  for (const value of ['false', undefined, 'TRUE', 'True', ' true', 'yes', '1', '']) {
    const handler = makeHandler({ ssm: fakeSsm({ [NAMES.client]: WEB_CLIENT, [NAMES.open]: value }), stage: STAGE });
    assert.equal(await refusal(handler(event())), REASONS.closed, `signup-open ${JSON.stringify(value)} is closed`);
  }
  assert.equal(REASONS.closed, 'signup_closed');
});

test('T-WINF-3 refuses a disposable domain from disposable-email-domains, in any case, and subdomains of its wildcard list', async () => {
  const handler = makeHandler({ ssm: fakeSsm(open), stage: STAGE });
  for (const email of ['someone@mailinator.com', 'Someone@MAILINATOR.COM', 'someone@sub.33m.co', 'a@b@mailinator.com']) {
    assert.equal(await refusal(handler(event({ email }))), REASONS.disposable, `${email} is disposable`);
  }
  assert.equal(REASONS.disposable, 'disposable_email');
  // An ordinary domain that merely ends like a listed one is not refused.
  assert.ok(await handler(event({ email: 'someone@notmailinator.com.example.test' })));
});

test('T-WINF-3 refuses an address with no domain', async () => {
  const handler = makeHandler({ ssm: fakeSsm(open), stage: STAGE });
  for (const email of ['no-at-sign', 'trailing@', '', undefined]) {
    assert.equal(await refusal(handler(event({ email }))), REASONS.email, `${JSON.stringify(email)} has no domain`);
  }
});

test('T-WINF-3 checks the client before the switch and the switch before the domain', async () => {
  const closed = makeHandler({ ssm: fakeSsm({ [NAMES.client]: WEB_CLIENT, [NAMES.open]: 'false' }), stage: STAGE });
  assert.equal(await refusal(closed(event({ clientId: OTHER_CLIENT, email: 'x@mailinator.com' }))), REASONS.client);
  assert.equal(await refusal(closed(event({ email: 'x@mailinator.com' }))), REASONS.closed);
});

test('T-WINF-3 reads both parameters of its stage in one call and caches them for 60 seconds', async () => {
  let clock = 1_000_000;
  const ssm = fakeSsm(open);
  const handler = makeHandler({ ssm, stage: STAGE, now: () => clock });
  await handler(event());
  assert.equal(ssm.calls.length, 1);
  assert.deepEqual([...ssm.calls[0].input.Names].sort(), [NAMES.client, NAMES.open].sort());
  assert.notEqual(ssm.calls[0].input.WithDecryption, true, 'plain String parameters');
  clock += 59_999;
  await handler(event());
  assert.equal(ssm.calls.length, 1, 'cached within 60 seconds');
  clock += 1;
  await handler(event());
  assert.equal(ssm.calls.length, 2, 'read again after 60 seconds');
});

test('T-WINF-3 a closed switch turned on is seen within 60 seconds', async () => {
  let clock = 0;
  const values = { [NAMES.client]: WEB_CLIENT, [NAMES.open]: 'false' };
  const handler = makeHandler({ ssm: fakeSsm(values), stage: STAGE, now: () => clock });
  assert.equal(await refusal(handler(event())), REASONS.closed);
  values[NAMES.open] = 'true';
  clock += 60_000;
  assert.ok(await handler(event()));
});

test('T-WINF-3 fails closed when SSM fails, and does not cache the failure', async () => {
  let fail = true;
  const ok = fakeSsm(open);
  const ssm = {
    async send(command) {
      if (fail) throw new Error('fake SSM outage');
      return ok.send(command);
    },
  };
  const handler = makeHandler({ ssm, stage: STAGE, now: () => 0 });
  await assert.rejects(handler(event()), /fake SSM outage/);
  fail = false;
  assert.ok(await handler(event()), 'the next call reads again');
});

test('T-WINF-3 a refusal does not put the email in the error', async () => {
  const handler = makeHandler({ ssm: fakeSsm(open), stage: STAGE });
  const message = await refusal(handler(event({ email: 'someone@mailinator.com' })));
  assert.equal(message.includes('someone'), false);
  assert.equal(message.includes('mailinator'), false);
});
