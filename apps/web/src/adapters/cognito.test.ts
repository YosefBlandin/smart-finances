import { describe, expect, it } from 'vitest';
import type { SecretStore } from '@/ports/secret-store';
import { CognitoIdentityProvider, secretHash, type CognitoClient } from './cognito';
import { MemoryClock } from './memory/clock';
import { MemoryIdentityProvider, TEST_AUTHENTICATOR_CODE, TEST_EMAIL_CODE } from './memory/identity-provider';

// Synthetic values only: example.test addresses, the all-zero account id, made-up tokens.
const SECRET = 'example-client-secret';
const SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:000000000000:secret:smart-finances/qa/web-client-secret-AbCdEf';
const CLIENT_ID = 'test-client';
const POOL_ID = 'us-east-1_Example0';
const EMAIL = 'person@example.test';
const SUB = '00000000-0000-4000-8000-000000000001';
// base64(HMAC-SHA256(SECRET, username + CLIENT_ID)), computed with openssl.
const HASH_EMAIL = '/vYdGkOWAL7jQC7GgrGd3cxROwYh1uGEmz2jfKW8DDY=';
const HASH_SUB = 'AlgE/i6LxW4ftu7ba2rPXrGhJS6wwK/wz9TtNHvp3qg=';
const NOW = 1_790_000_000_000;

type Sent = { name: string; input: Record<string, unknown> };
type Reply = Record<string, unknown> | { throws: string };

// A hand-written fake SDK client: records every command and answers from a script keyed by command name.
class FakeClient implements CognitoClient {
  readonly sent: Sent[] = [];
  constructor(private readonly script: Record<string, Reply | Reply[]> = {}) {}
  async send(command: { input: object }) {
    const name = command.constructor.name;
    this.sent.push({ name, input: command.input as Record<string, unknown> });
    const entry = this.script[name];
    const reply = Array.isArray(entry) ? entry.shift() : entry;
    if (reply && 'throws' in reply) {
      const e = new Error(`fake ${reply.throws} for ${EMAIL}`);
      e.name = String(reply.throws);
      throw e;
    }
    return { $metadata: {}, ...(reply ?? {}) };
  }
  only(name: string) {
    const found = this.sent.filter((s) => s.name === name);
    expect(found, name).toHaveLength(1);
    return found[0]!.input;
  }
}

class FakeSecrets implements SecretStore {
  readonly reads: string[] = [];
  constructor(private readonly fail = false) {}
  async get(arn: string) {
    this.reads.push(arn);
    if (this.fail) throw new Error('Secret could not be read: AccessDeniedException');
    return SECRET;
  }
}

function setup(script: Record<string, Reply | Reply[]> = {}, opts: { failSecret?: boolean } = {}) {
  const client = new FakeClient(script);
  const secrets = new FakeSecrets(opts.failSecret);
  const idp = new CognitoIdentityProvider({
    client,
    userPoolId: POOL_ID,
    clientId: CLIENT_ID,
    clientSecretArn: SECRET_ARN,
    secretStore: secrets,
    clock: new MemoryClock(NOW),
  });
  return { client, secrets, idp };
}

const AUTH_RESULT = { AccessToken: 'access-1', IdToken: 'id-1', RefreshToken: 'refresh-1', ExpiresIn: 3600, TokenType: 'Bearer' };
const TOKENS = { access: 'access-1', id: 'id-1', refresh: 'refresh-1', expiresAt: NOW + 3_600_000 };

describe('T-WAUTH-18: the Cognito adapter sends the secret hash and language metadata', () => {
  it('T-WAUTH-18: the secret hash is base64(HMAC-SHA256(secret, username + client id))', () => {
    expect(secretHash(SECRET, EMAIL, CLIENT_ID)).toBe(HASH_EMAIL);
    expect(secretHash(SECRET, SUB, CLIENT_ID)).toBe(HASH_SUB);
  });

  it('T-WAUTH-18: sign-up sends the lower-cased email, the secret hash read from the ARN and clientMetadata.lang', async () => {
    const { client, secrets, idp } = setup({ SignUpCommand: { UserSub: SUB, UserConfirmed: false } });
    expect(await idp.signUp('  Person@Example.TEST ', 'a long enough password', 'es')).toEqual({ ok: true });
    expect(client.only('SignUpCommand')).toEqual({
      ClientId: CLIENT_ID,
      SecretHash: HASH_EMAIL,
      Username: EMAIL,
      Password: 'a long enough password',
      UserAttributes: [{ Name: 'email', Value: EMAIL }],
      ClientMetadata: { lang: 'es' },
    });
    expect(secrets.reads).toEqual([SECRET_ARN]);
  });

  it('T-WAUTH-18: resend and forgot send the secret hash and clientMetadata.lang; confirm and confirmForgot the hash', async () => {
    const { client, idp } = setup();
    expect(await idp.resend(EMAIL, 'en')).toEqual({ ok: true });
    expect(await idp.forgot(EMAIL, 'es')).toEqual({ ok: true });
    expect(await idp.confirm(EMAIL, '123456')).toEqual({ ok: true });
    expect(await idp.confirmForgot(EMAIL, '654321', 'a new long password')).toEqual({ ok: true });
    expect(client.only('ResendConfirmationCodeCommand')).toEqual({
      ClientId: CLIENT_ID,
      SecretHash: HASH_EMAIL,
      Username: EMAIL,
      ClientMetadata: { lang: 'en' },
    });
    expect(client.only('ForgotPasswordCommand')).toEqual({
      ClientId: CLIENT_ID,
      SecretHash: HASH_EMAIL,
      Username: EMAIL,
      ClientMetadata: { lang: 'es' },
    });
    expect(client.only('ConfirmSignUpCommand')).toEqual({ ClientId: CLIENT_ID, SecretHash: HASH_EMAIL, Username: EMAIL, ConfirmationCode: '123456' });
    expect(client.only('ConfirmForgotPasswordCommand')).toEqual({
      ClientId: CLIENT_ID,
      SecretHash: HASH_EMAIL,
      Username: EMAIL,
      ConfirmationCode: '654321',
      Password: 'a new long password',
    });
  });

  it('T-WAUTH-18: the password step uses USER_PASSWORD_AUTH with the hash, no context data, and returns the challenge', async () => {
    const { client, idp } = setup({
      InitiateAuthCommand: [
        { ChallengeName: 'MFA_SETUP', Session: 'sess-1' },
        { ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: 'sess-2' },
      ],
    });
    expect(await idp.passwordAuth(EMAIL, 'a long enough password')).toEqual({ ok: true, challenge: 'MFA_SETUP', session: 'sess-1' });
    expect(await idp.passwordAuth(EMAIL, 'a long enough password')).toEqual({ ok: true, challenge: 'SOFTWARE_TOKEN_MFA', session: 'sess-2' });
    expect(client.sent[0]).toEqual({
      name: 'InitiateAuthCommand',
      input: {
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: CLIENT_ID,
        AuthParameters: { USERNAME: EMAIL, PASSWORD: 'a long enough password', SECRET_HASH: HASH_EMAIL },
      },
    });
    expect(client.sent[0]!.input).not.toHaveProperty('UserContextData');
  });

  it('T-WAUTH-18: authenticator setup associates, verifies and answers MFA_SETUP with the hash to get tokens', async () => {
    const { client, idp } = setup({
      AssociateSoftwareTokenCommand: { SecretCode: 'JBSWY3DPEHPK3PXP', Session: 'sess-a' },
      VerifySoftwareTokenCommand: { Status: 'SUCCESS', Session: 'sess-v' },
      RespondToAuthChallengeCommand: { AuthenticationResult: AUTH_RESULT },
    });
    expect(await idp.associate('sess-1')).toEqual({ ok: true, secret: 'JBSWY3DPEHPK3PXP', session: 'sess-a' });
    expect(await idp.verifySetup(EMAIL, 'sess-a', '123123')).toEqual({ ok: true, tokens: TOKENS });
    expect(client.only('AssociateSoftwareTokenCommand')).toEqual({ Session: 'sess-1' });
    expect(client.only('VerifySoftwareTokenCommand')).toEqual({ Session: 'sess-a', UserCode: '123123', FriendlyDeviceName: 'Cuenta' });
    expect(client.only('RespondToAuthChallengeCommand')).toEqual({
      ClientId: CLIENT_ID,
      ChallengeName: 'MFA_SETUP',
      Session: 'sess-v',
      ChallengeResponses: { USERNAME: EMAIL, SECRET_HASH: HASH_EMAIL },
    });
  });

  it('T-WAUTH-18: the code step answers SOFTWARE_TOKEN_MFA with the hash and returns tokens', async () => {
    const { client, idp } = setup({ RespondToAuthChallengeCommand: { AuthenticationResult: AUTH_RESULT } });
    expect(await idp.respondCode('Person@example.test', 'sess-2', '123123')).toEqual({ ok: true, tokens: TOKENS });
    expect(client.only('RespondToAuthChallengeCommand')).toEqual({
      ClientId: CLIENT_ID,
      ChallengeName: 'SOFTWARE_TOKEN_MFA',
      Session: 'sess-2',
      ChallengeResponses: { USERNAME: EMAIL, SOFTWARE_TOKEN_MFA_CODE: '123123', SECRET_HASH: HASH_EMAIL },
    });
  });

  it('T-WAUTH-18: refresh hashes with the sub and keeps the refresh token; revoke sends the client secret', async () => {
    const { client, idp } = setup({
      InitiateAuthCommand: { AuthenticationResult: { AccessToken: 'access-2', IdToken: 'id-2', ExpiresIn: 3600 } },
      RevokeTokenCommand: {},
    });
    expect(await idp.refresh(SUB, 'refresh-1')).toEqual({
      ok: true,
      tokens: { access: 'access-2', id: 'id-2', refresh: 'refresh-1', expiresAt: NOW + 3_600_000 },
    });
    expect(client.only('InitiateAuthCommand')).toEqual({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: { REFRESH_TOKEN: 'refresh-1', SECRET_HASH: HASH_SUB },
    });
    expect(await idp.revoke('refresh-1')).toEqual({ ok: true });
    expect(client.only('RevokeTokenCommand')).toEqual({ Token: 'refresh-1', ClientId: CLIENT_ID, ClientSecret: SECRET });
  });

  it('T-WAUTH-18: admin calls name this pool; adminGet answers the sub and status, delete and sign-out take the sub', async () => {
    const { client, idp } = setup({
      AdminGetUserCommand: {
        Username: SUB,
        UserStatus: 'CONFIRMED',
        UserAttributes: [
          { Name: 'sub', Value: SUB },
          { Name: 'email', Value: EMAIL },
        ],
      },
    });
    expect(await idp.adminGet('PERSON@example.test')).toEqual({ ok: true, sub: SUB, status: 'CONFIRMED' });
    expect(await idp.adminDelete(SUB)).toEqual({ ok: true });
    expect(await idp.adminGlobalSignOut(SUB)).toEqual({ ok: true });
    expect(client.only('AdminGetUserCommand')).toEqual({ UserPoolId: POOL_ID, Username: EMAIL });
    expect(client.only('AdminDeleteUserCommand')).toEqual({ UserPoolId: POOL_ID, Username: SUB });
    expect(client.only('AdminUserGlobalSignOutCommand')).toEqual({ UserPoolId: POOL_ID, Username: SUB });
  });

  it('T-WAUTH-18: service errors become reasons, never throws, and carry no email or message', async () => {
    const run = async (name: string, error: string, call: (idp: CognitoIdentityProvider) => Promise<unknown>, reason: string) => {
      const { idp } = setup({ [name]: { throws: error } });
      const out = await call(idp);
      expect(out, `${name} ${error}`).toEqual({ ok: false, reason });
    };
    await run('SignUpCommand', 'UsernameExistsException', (i) => i.signUp(EMAIL, 'a long enough password', 'en'), 'exists');
    await run('SignUpCommand', 'InvalidPasswordException', (i) => i.signUp(EMAIL, 'short', 'en'), 'bad_password');
    await run('SignUpCommand', 'UserLambdaValidationException', (i) => i.signUp(EMAIL, 'a long enough password', 'en'), 'refused');
    await run('SignUpCommand', 'TooManyRequestsException', (i) => i.signUp(EMAIL, 'a long enough password', 'en'), 'limited');
    await run('ConfirmSignUpCommand', 'CodeMismatchException', (i) => i.confirm(EMAIL, '000001'), 'bad_code');
    await run('ConfirmSignUpCommand', 'ExpiredCodeException', (i) => i.confirm(EMAIL, '000001'), 'expired_code');
    await run('ConfirmSignUpCommand', 'TooManyFailedAttemptsException', (i) => i.confirm(EMAIL, '000001'), 'limited');
    await run('ResendConfirmationCodeCommand', 'LimitExceededException', (i) => i.resend(EMAIL, 'en'), 'limited');
    await run('InitiateAuthCommand', 'NotAuthorizedException', (i) => i.passwordAuth(EMAIL, 'wrong password!'), 'bad_credentials');
    await run('InitiateAuthCommand', 'UserNotFoundException', (i) => i.passwordAuth(EMAIL, 'wrong password!'), 'bad_credentials');
    await run('InitiateAuthCommand', 'UserNotConfirmedException', (i) => i.passwordAuth(EMAIL, 'a long enough password'), 'unconfirmed');
    await run('InitiateAuthCommand', 'NotAuthorizedException', (i) => i.refresh(SUB, 'refresh-1'), 'revoked');
    await run('AssociateSoftwareTokenCommand', 'NotAuthorizedException', (i) => i.associate('old'), 'bad_session');
    await run('VerifySoftwareTokenCommand', 'EnableSoftwareTokenMFAException', (i) => i.verifySetup(EMAIL, 's', '111111'), 'bad_code');
    await run('VerifySoftwareTokenCommand', 'CodeMismatchException', (i) => i.verifySetup(EMAIL, 's', '111111'), 'bad_code');
    await run('RespondToAuthChallengeCommand', 'CodeMismatchException', (i) => i.respondCode(EMAIL, 's', '111111'), 'bad_code');
    await run('RespondToAuthChallengeCommand', 'NotAuthorizedException', (i) => i.respondCode(EMAIL, 's', '111111'), 'bad_session');
    await run('ConfirmForgotPasswordCommand', 'ExpiredCodeException', (i) => i.confirmForgot(EMAIL, '1', 'a new long password'), 'expired_code');
    await run('ConfirmForgotPasswordCommand', 'InvalidPasswordException', (i) => i.confirmForgot(EMAIL, '1', 'short'), 'bad_password');
    await run('AdminGetUserCommand', 'UserNotFoundException', (i) => i.adminGet(EMAIL), 'not_found');
    await run('AdminDeleteUserCommand', 'UserNotFoundException', (i) => i.adminDelete(SUB), 'not_found');
    await run('AdminUserGlobalSignOutCommand', 'InternalErrorException', (i) => i.adminGlobalSignOut(SUB), 'failed');
    await run('ForgotPasswordCommand', 'SomethingNewException', (i) => i.forgot(EMAIL, 'en'), 'failed');
  });

  it('T-WAUTH-18: a failed verify status or a reply without tokens is a reason, not a crash', async () => {
    const bad = setup({ VerifySoftwareTokenCommand: { Status: 'ERROR' } });
    expect(await bad.idp.verifySetup(EMAIL, 's', '111111')).toEqual({ ok: false, reason: 'bad_code' });
    expect(bad.client.sent.map((s) => s.name)).toEqual(['VerifySoftwareTokenCommand']);
    const noTokens = setup({ RespondToAuthChallengeCommand: { ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: 'again' } });
    expect(await noTokens.idp.respondCode(EMAIL, 's', '111111')).toEqual({ ok: false, reason: 'failed' });
    const odd = setup({ InitiateAuthCommand: { ChallengeName: 'NEW_PASSWORD_REQUIRED', Session: 'x' } });
    expect(await odd.idp.passwordAuth(EMAIL, 'a long enough password')).toEqual({ ok: false, reason: 'failed' });
  });

  it('T-WAUTH-18: when the client secret cannot be read, nothing is sent and the reason is failed', async () => {
    const { client, idp } = setup({}, { failSecret: true });
    expect(await idp.signUp(EMAIL, 'a long enough password', 'en')).toEqual({ ok: false, reason: 'failed' });
    expect(await idp.revoke('refresh-1')).toEqual({ ok: false, reason: 'failed' });
    expect(client.sent).toEqual([]);
  });
});

describe('T-WAUTH-18: the memory fake accepts only its fixed codes', () => {
  // Confirms an existing sign-up with the right code and returns the setup session after associate.
  async function confirmedWithAuthenticator(idp: MemoryIdentityProvider, email: string) {
    expect(await idp.confirm(email, TEST_EMAIL_CODE)).toEqual({ ok: true });
    const first = await idp.passwordAuth(email, 'a long enough password');
    if (!first.ok || !('challenge' in first)) throw new Error('expected a challenge');
    const assoc = await idp.associate(first.session);
    if (!assoc.ok) throw new Error('associate failed');
    return assoc.session;
  }

  it('T-WAUTH-18: the email code is 123456 and nothing else, the authenticator code 000000 and nothing else', async () => {
    expect([TEST_EMAIL_CODE, TEST_AUTHENTICATOR_CODE]).toEqual(['123456', '000000']);
    const idp = new MemoryIdentityProvider(new MemoryClock(NOW));
    await idp.signUp(EMAIL, 'a long enough password', 'en');
    for (const code of ['000000', '654321', '12345', '1234567', ''])
      expect(await idp.confirm(EMAIL, code), code).toEqual({ ok: false, reason: 'bad_code' });
    const setupSession = await confirmedWithAuthenticator(idp, EMAIL);
    for (const code of ['123456', '000001', ''])
      expect(await idp.verifySetup(EMAIL, setupSession, code), code).toEqual({ ok: false, reason: 'bad_code' });
    const done = await idp.verifySetup(EMAIL, setupSession, TEST_AUTHENTICATOR_CODE);
    expect(done.ok && 'tokens' in done && done.tokens.access.length > 0).toBe(true);
    const second = await idp.passwordAuth(EMAIL, 'a long enough password');
    if (!second.ok || !('challenge' in second)) throw new Error('expected a challenge');
    expect(second.challenge).toBe('SOFTWARE_TOKEN_MFA');
    expect(await idp.respondCode(EMAIL, second.session, TEST_EMAIL_CODE)).toEqual({ ok: false, reason: 'bad_code' });
    expect((await idp.respondCode(EMAIL, second.session, TEST_AUTHENTICATOR_CODE)).ok).toBe(true);
    await idp.forgot(EMAIL, 'en');
    expect(await idp.confirmForgot(EMAIL, TEST_AUTHENTICATOR_CODE, 'a new long password')).toEqual({ ok: false, reason: 'bad_code' });
    expect(await idp.confirmForgot(EMAIL, TEST_EMAIL_CODE, 'a new long password')).toEqual({ ok: true });
  });

  it('T-WAUTH-18: subs are deterministic: the same sign-ups in two fakes give the same subs', async () => {
    const subsOf = async () => {
      const idp = new MemoryIdentityProvider(new MemoryClock(NOW));
      const subs: string[] = [];
      for (const email of ['a@example.test', 'b@example.test']) {
        await idp.signUp(email, 'a long enough password', 'en');
        const got = await idp.adminGet(email);
        if (!got.ok) throw new Error('adminGet failed');
        subs.push(got.sub);
      }
      return subs;
    };
    const first = await subsOf();
    expect(await subsOf()).toEqual(first);
    expect(new Set(first).size).toBe(2);
    for (const sub of first) expect(sub).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('T-WAUTH-18: the fake lower-cases the email like the adapter and records each code email with its language', async () => {
    const idp = new MemoryIdentityProvider(new MemoryClock(NOW));
    await idp.signUp('Person@Example.test', 'a long enough password', 'es');
    expect(await idp.signUp('person@example.test', 'a long enough password', 'en')).toEqual({ ok: false, reason: 'exists' });
    await idp.resend('PERSON@example.test', 'en');
    await idp.forgot('person@example.test', 'es');
    expect(idp.codeEmails).toEqual([
      { email: EMAIL, kind: 'signup', lang: 'es' },
      { email: EMAIL, kind: 'resend', lang: 'en' },
      { email: EMAIL, kind: 'forgot', lang: 'es' },
    ]);
    expect(await idp.confirm('PERSON@EXAMPLE.TEST', TEST_EMAIL_CODE)).toEqual({ ok: true });
  });
});
