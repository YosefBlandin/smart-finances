import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { handler, MESSAGES } from './custom-message.mjs';

// Synthetic values only: an obviously fake pool, user and client, and an example.test address.
const CODE = '{####}';

// Overrides are spread over the defaults, so an explicit undefined removes a value.
function event(overrides = {}) {
  const { triggerSource, clientMetadata, codeParameter } = {
    triggerSource: 'CustomMessage_SignUp',
    clientMetadata: { lang: 'en' },
    codeParameter: CODE,
    ...overrides,
  };
  return {
    version: '1',
    triggerSource,
    region: 'us-east-1',
    userPoolId: 'us-east-1_FAKEPOOL0',
    userName: '00000000-0000-4000-8000-000000000000',
    callerContext: { awsSdkVersion: 'aws-sdk-unknown-unknown', clientId: 'fakewebserverclient000000' },
    request: {
      userAttributes: { email: 'person@example.test', email_verified: 'false' },
      codeParameter,
      linkParameter: '{##Click Here##}',
      usernameParameter: null,
      clientMetadata,
    },
    response: { smsMessage: null, emailMessage: null, emailSubject: null },
  };
}

// Sign-up, a resent sign-up code and a password reset all send a code by email.
const CODE_SOURCES = ['CustomMessage_SignUp', 'CustomMessage_ResendCode', 'CustomMessage_ForgotPassword'];

function sentences(text) {
  return text.split(/(?<=[.!?])\s+/).filter(Boolean);
}

test('T-WINF-5 sign-up, resent and reset code emails come out in English for lang "en"', async () => {
  for (const triggerSource of CODE_SOURCES) {
    const out = await handler(event({ triggerSource, clientMetadata: { lang: 'en' } }));
    assert.equal(out.response.emailSubject, 'Your Cuenta code', triggerSource);
    assert.equal(out.response.emailMessage, MESSAGES.en.message, triggerSource);
    assert.ok(out.response.emailMessage.includes(CODE), `${triggerSource}: the message carries the code placeholder`);
  }
});

test('T-WINF-5 sign-up, resent and reset code emails come out in Spanish for lang "es"', async () => {
  for (const triggerSource of CODE_SOURCES) {
    const out = await handler(event({ triggerSource, clientMetadata: { lang: 'es' } }));
    assert.equal(out.response.emailSubject, 'Tu código de Cuenta', triggerSource);
    assert.equal(out.response.emailMessage, MESSAGES.es.message, triggerSource);
    assert.ok(out.response.emailMessage.includes(CODE), `${triggerSource}: the message carries the code placeholder`);
  }
});

test('T-WINF-5 each message is one sentence with the code placeholder exactly once, and the Spanish one uses tú', () => {
  for (const lang of ['en', 'es']) {
    const { message } = MESSAGES[lang];
    assert.equal(sentences(message).length, 1, `${lang}: one sentence`);
    assert.equal(message.split(CODE).length - 1, 1, `${lang}: {####} once`);
    assert.doesNotMatch(message, /<|>/, `${lang}: plain text`);
  }
  assert.equal(MESSAGES.en.subject, 'Your Cuenta code');
  assert.equal(MESSAGES.es.subject, 'Tu código de Cuenta');
  assert.match(MESSAGES.es.message, /^Tu código/, 'D-11: Spanish addresses the person with tú');
  assert.doesNotMatch(MESSAGES.es.message, /\b(su|usted)\b/i, 'D-11: no usted');
});

test('T-WINF-5 the language falls back to English when lang is missing, unknown or not a string, and accepts a region or other case', async () => {
  for (const clientMetadata of [undefined, null, {}, { lang: '' }, { lang: 'fr' }, { lang: 'english' }, { lang: 42 }, { other: 'es' }]) {
    const out = await handler(event({ clientMetadata }));
    assert.equal(out.response.emailSubject, MESSAGES.en.subject, `${JSON.stringify(clientMetadata)} is English`);
    assert.equal(out.response.emailMessage, MESSAGES.en.message);
  }
  for (const lang of ['ES', 'es-ES', 'es-419', 'Es']) {
    const out = await handler(event({ clientMetadata: { lang } }));
    assert.equal(out.response.emailSubject, MESSAGES.es.subject, `${lang} is Spanish`);
  }
});

test('T-WINF-5 uses the code placeholder Cognito passes in codeParameter', async () => {
  const out = await handler(event({ codeParameter: '{####}' }));
  assert.ok(out.response.emailMessage.includes('{####}'));
});

test('T-WINF-5 leaves other messages (admin invite, attribute update and verify, sign-in code) to the pool, unchanged', async () => {
  for (const triggerSource of [
    'CustomMessage_AdminCreateUser',
    'CustomMessage_UpdateUserAttribute',
    'CustomMessage_VerifyUserAttribute',
    'CustomMessage_Authentication',
  ]) {
    const input = event({ triggerSource, clientMetadata: { lang: 'es' } });
    const out = await handler(input);
    assert.deepEqual(out, event({ triggerSource, clientMetadata: { lang: 'es' } }), `${triggerSource} is untouched`);
  }
});

test('T-WINF-5 keeps the rest of the event, sets no SMS text and does not log the event', async () => {
  const logged = [];
  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(original)) console[k] = (...args) => logged.push(args);
  try {
    const out = await handler(event({ clientMetadata: { lang: 'es' } }));
    const expected = event({ clientMetadata: { lang: 'es' } });
    assert.deepEqual(out.request, expected.request);
    assert.equal(out.userName, expected.userName);
    assert.equal(out.response.smsMessage, null);
  } finally {
    Object.assign(console, original);
  }
  assert.deepEqual(logged, [], 'nothing logged: the event holds the email');
});
