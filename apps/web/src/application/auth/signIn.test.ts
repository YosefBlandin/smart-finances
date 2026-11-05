/* eslint-disable import/no-restricted-paths -- T-WAUTH-11 and T-WAUTH-12 drive the sign-in use case over the memory
   adapters (the STAGE=test container), which is the task's one test file; no production application code imports
   adapters. */
import { describe, expect, it } from 'vitest';
import { memoryContainer, type Container } from '@/adapters/container';
import { MemoryClock } from '@/adapters/memory/clock';
import { TEST_AUTHENTICATOR_CODE, TEST_EMAIL_CODE, type MemoryIdentityProvider } from '@/adapters/memory/identity-provider';
import type { MemoryLogger } from '@/adapters/memory/logger';
import { createSessions } from '@/application/session';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/legal/versions';
import type { IdentityProvider } from '@/ports/identity-provider';
import { createConfirm } from './confirm';
import { createSignIn, issuerFor, MAX_CODE_ATTEMPTS, otpauthUri, safeNext } from './signIn';
import { createSignUp, REPLY_MS } from './signUp';

// T-WAUTH-11 (AC-1, AC-13) and T-WAUTH-12 (AC-1, D-91): the password step, the authenticator setup and the code step as
// use cases over the memory adapters. Synthetic addresses only; the fake's authenticator code is 000000.

const START = Date.UTC(2026, 10, 4, 10, 0, 0);
const PASSWORD = 'correct horse battery staple';
const EMAIL = 'person@example.test';
const VERSIONS = { terms: TERMS_VERSION, privacy: PRIVACY_VERSION };
const MIN = 60_000;

/** A memory container with a hand-moved clock; overrides replace identity calls (to fake an expired challenge). */
function setup(overrides: Partial<IdentityProvider> = {}) {
  const clock = new MemoryClock(START);
  const container: Container = memoryContainer(undefined, clock);
  const idp = container.identityProvider as MemoryIdentityProvider;
  const identityProvider = new Proxy(idp, {
    get(target, prop, receiver) {
      const own = (overrides as Record<string | symbol, unknown>)[prop];
      if (typeof own === 'function') return own;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const sleep = async (ms: number) => clock.advance(ms);
  const deps = { ...container, identityProvider, sleep };
  const signIn = createSignIn(deps);
  const sessions = createSessions(container);
  const logger = container.logger as MemoryLogger;
  return { clock, container, idp, signIn, sessions, logger, deps };
}

/** A confirmed account straight on the fake pool. */
async function confirmed(idp: MemoryIdentityProvider, email = EMAIL, password = PASSWORD) {
  await idp.signUp(email, password, 'en');
  await idp.confirm(email, TEST_EMAIL_CODE);
  const got = await idp.adminGet(email);
  if (!got.ok) throw new Error('no account');
  return got.sub;
}

const ctx = (extra: Record<string, unknown> = {}) => ({ requestId: 'req-1', ip: '192.0.2.10', lang: 'en' as const, ...extra });

type T = ReturnType<typeof setup>;

/** Password step then setup with the right code: the first sign-in. */
async function firstSignIn(t: T, email = EMAIL) {
  const pw = await t.signIn.signIn(email, PASSWORD, ctx());
  if (!pw.ok) throw new Error(`password step refused: ${pw.messageKey}`);
  const done = await t.signIn.verifySetup(TEST_AUTHENTICATOR_CODE, ctx({ preAuthId: pw.data.preAuthId }));
  if (!done.ok || !('sessionId' in done.data)) throw new Error('setup refused');
  return done.data.sessionId;
}

describe('T-WAUTH-11: the first sign-in walks setup then code; no session before the code', () => {
  it('T-WAUTH-11: a new account goes to setup with a fresh key in the pre-auth row, and no session exists yet', async () => {
    const t = setup();
    const sub = await confirmed(t.idp);
    const pw = await t.signIn.signIn('Person@Example.test ', PASSWORD, ctx());
    expect(pw.ok).toBe(true);
    if (!pw.ok) return;
    expect(pw.data.next).toBe('/sign-in/setup');
    const row = await t.sessions.readPreAuth(pw.data.preAuthId);
    expect(row).toMatchObject({ step: 'setup', email: EMAIL, attempts: 0, lang: 'en' });
    expect(row?.totpSecret).toMatch(/^[A-Z2-7]{16,}$/);
    expect(row?.challengeSession).toBeTruthy();
    expect(await t.container.sessionStore.listBySub(sub)).toEqual([]);
    expect(t.logger.events.map((e) => [e.name, e.outcome])).toEqual([['signin', 'setup']]);
  });

  it('T-WAUTH-11: the setup screen gets the key, the otpauth address and a server-drawn QR path for the stage issuer', async () => {
    const t = setup();
    await confirmed(t.idp);
    const pw = await t.signIn.signIn(EMAIL, PASSWORD, ctx());
    if (!pw.ok) throw new Error('refused');
    const view = await t.signIn.setupView(pw.data.preAuthId);
    const row = await t.sessions.readPreAuth(pw.data.preAuthId);
    expect(view).not.toBeNull();
    if (!view) return;
    expect(view.secret).toBe(row?.totpSecret);
    expect(view.issuer).toBe('Cuenta test');
    expect(view.uri).toBe(`otpauth://totp/Cuenta%20test:person%40example.test?secret=${view.secret}&issuer=Cuenta%20test`);
    // A QR code of version 1 or more: at least 21 modules plus the 4-module quiet zone on each side.
    expect(view.qr.size).toBeGreaterThanOrEqual(29);
    expect(view.qr.path).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
    // No setup view without a setup row.
    expect(await t.signIn.setupView(undefined)).toBeNull();
    expect(await t.signIn.codeStep(pw.data.preAuthId)).toBe(false);
  });

  it('T-WAUTH-11: the issuer is Cuenta on prod and names the stage elsewhere', () => {
    expect(issuerFor('prod')).toBe('Cuenta');
    expect(issuerFor('qa')).toBe('Cuenta qa');
    expect(issuerFor('staging')).toBe('Cuenta staging');
    expect(issuerFor('test')).toBe('Cuenta test');
    expect(otpauthUri('Cuenta', 'a+b@example.test', 'ABC234')).toBe('otpauth://totp/Cuenta:a%2Bb%40example.test?secret=ABC234&issuer=Cuenta');
  });

  it('T-WAUTH-11: a wrong setup code keeps the same key and makes no session; the right one makes a new session and ends the pre-auth row', async () => {
    const t = setup();
    const sub = await confirmed(t.idp);
    const pw = await t.signIn.signIn(EMAIL, PASSWORD, ctx());
    if (!pw.ok) throw new Error('refused');
    const key = (await t.sessions.readPreAuth(pw.data.preAuthId))?.totpSecret;

    const wrong = await t.signIn.verifySetup('111111', ctx({ preAuthId: pw.data.preAuthId }));
    expect(wrong).toEqual({ ok: false, messageKey: 'auth.setup.errWrong' });
    expect((await t.sessions.readPreAuth(pw.data.preAuthId))?.totpSecret).toBe(key);
    expect(await t.container.sessionStore.listBySub(sub)).toEqual([]);

    const done = await t.signIn.verifySetup(` ${TEST_AUTHENTICATOR_CODE} `, ctx({ preAuthId: pw.data.preAuthId }));
    expect(done.ok).toBe(true);
    if (!done.ok || !('sessionId' in done.data)) return;
    expect(done.data.next).toBe('/overview');
    const session = await t.sessions.getSession(done.data.sessionId);
    expect(session?.sub).toBe(sub);
    expect(await t.sessions.readPreAuth(pw.data.preAuthId)).toBeNull();
    expect(t.logger.events.map((e) => [e.name, e.outcome])).toEqual([
      ['signin', 'setup'],
      ['mfa_setup', 'bad_code'],
      ['mfa_setup', 'ok'],
      ['signin', 'ok'],
    ]);
    expect(t.logger.events.at(-1)?.sub).toBe(sub);
  });

  it('T-WAUTH-11: a later sign-in goes straight to the code; a wrong code makes no session; the right one a new session id', async () => {
    const t = setup();
    const sub = await confirmed(t.idp);
    const firstId = await firstSignIn(t);

    const pw = await t.signIn.signIn(EMAIL, PASSWORD, ctx({ requestId: 'req-2' }));
    if (!pw.ok) throw new Error('refused');
    expect(pw.data.next).toBe('/sign-in/code');
    expect(await t.sessions.readPreAuth(pw.data.preAuthId)).toMatchObject({ step: 'code', email: EMAIL });
    expect(await t.signIn.codeStep(pw.data.preAuthId)).toBe(true);
    expect(await t.signIn.setupView(pw.data.preAuthId)).toBeNull();

    expect(await t.signIn.verifyCode('123456', ctx({ preAuthId: pw.data.preAuthId, sessionId: firstId }))).toEqual({
      ok: false,
      messageKey: 'auth.code.errWrong',
    });
    expect(await t.container.sessionStore.listBySub(sub)).toHaveLength(1);

    const done = await t.signIn.verifyCode(TEST_AUTHENTICATOR_CODE, ctx({ preAuthId: pw.data.preAuthId, sessionId: firstId }));
    expect(done.ok).toBe(true);
    if (!done.ok || !('sessionId' in done.data)) return;
    expect(done.data.sessionId).not.toBe(firstId);
    // A new id at sign-in: the previous session of this browser is gone, the new one is the only one.
    expect(await t.sessions.getSession(firstId)).toBeNull();
    expect((await t.sessions.getSession(done.data.sessionId))?.sub).toBe(sub);
    expect(await t.container.sessionStore.listBySub(sub)).toHaveLength(1);
  });

  it('T-WAUTH-11: the accepted versions from the confirmed sign-up row stay in the sign-in row until the session', async () => {
    const t = setup();
    const signUp = createSignUp({ ...t.deps, versions: VERSIONS });
    const { confirm } = createConfirm(t.deps);
    const up = await signUp({ email: EMAIL, password: PASSWORD, accepted: true, lang: 'es' }, { requestId: 'r' });
    if (!up.ok) throw new Error('refused');
    await confirm({ code: TEST_EMAIL_CODE }, { requestId: 'r', preAuthId: up.data.preAuthId });

    const pw = await t.signIn.signIn(EMAIL, PASSWORD, ctx({ preAuthId: up.data.preAuthId, lang: 'es' }));
    if (!pw.ok) throw new Error('refused');
    expect(pw.data.preAuthId).not.toBe(up.data.preAuthId);
    expect(await t.sessions.readPreAuth(up.data.preAuthId)).toBeNull();
    expect(await t.sessions.readPreAuth(pw.data.preAuthId)).toMatchObject({ step: 'setup', acceptedVersions: VERSIONS, lang: 'es' });

    // Another email's row hands nothing over.
    await confirmed(t.idp, 'other@example.test');
    const other = await t.signIn.signIn('other@example.test', PASSWORD, ctx({ preAuthId: pw.data.preAuthId }));
    if (!other.ok) throw new Error('refused');
    expect((await t.sessions.readPreAuth(other.data.preAuthId))?.acceptedVersions).toBeUndefined();
  });

  it('T-WAUTH-11: a wrong email or password gets one message in the same time, logs signin_fail, and keeps no row', async () => {
    const t = setup();
    await confirmed(t.idp);
    for (const [email, password] of [
      [EMAIL, 'not the right password'],
      ['nobody@example.test', PASSWORD],
    ] as const) {
      const t0 = t.clock.now();
      const res = await t.signIn.signIn(email, password, ctx());
      expect(res).toEqual({ ok: false, messageKey: 'auth.signIn.errWrong' });
      expect(t.clock.now() - t0).toBe(REPLY_MS);
    }
    expect(t.logger.events.map((e) => [e.name, e.outcome])).toEqual([
      ['signin_fail', 'bad_credentials'],
      ['signin_fail', 'bad_credentials'],
    ]);
  });

  it('T-WAUTH-11: an unconfirmed account gets a new code within the cap and goes to confirm', async () => {
    const t = setup();
    await t.idp.signUp(EMAIL, PASSWORD, 'en');
    const replies = [];
    for (let i = 0; i < 3; i += 1) replies.push(await t.signIn.signIn(EMAIL, PASSWORD, ctx({ lang: 'es' })));
    for (const r of replies) {
      expect(r.ok && r.data.next).toBe('/sign-up/confirm');
      if (r.ok) expect(await t.sessions.readPreAuth(r.data.preAuthId)).toMatchObject({ step: 'confirm', email: EMAIL, lang: 'es' });
    }
    // The sign-up's own email is not counted by the fake pool's call; the cap (3 an hour) lets 3 resends through here,
    // and the 4th sign-in still goes to confirm with no email.
    const fourth = await t.signIn.signIn(EMAIL, PASSWORD, ctx({ lang: 'es' }));
    expect(fourth.ok && fourth.data.next).toBe('/sign-up/confirm');
    expect(t.idp.codeEmails.filter((e) => e.kind === 'resend')).toEqual([
      { email: EMAIL, kind: 'resend', lang: 'es' },
      { email: EMAIL, kind: 'resend', lang: 'es' },
      { email: EMAIL, kind: 'resend', lang: 'es' },
    ]);
    expect(t.logger.events.filter((e) => e.name === 'rate_limited').map((e) => e.outcome)).toEqual(['code-email']);
  });

  it('T-WAUTH-11: the sixth password post for one email and address prefix within 15 minutes is refused with the wait', async () => {
    const t = setup();
    await confirmed(t.idp);
    for (let i = 0; i < 5; i += 1)
      expect(await t.signIn.signIn(EMAIL, 'wrong password!', ctx())).toEqual({ ok: false, messageKey: 'auth.signIn.errWrong' });
    const sixth = await t.signIn.signIn(EMAIL, PASSWORD, ctx({ ip: '192.0.2.99' }));
    expect(sixth.ok).toBe(false);
    if (sixth.ok) return;
    expect(sixth.messageKey).toBe('auth.limited');
    expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
    expect(t.logger.events.at(-1)).toMatchObject({ name: 'rate_limited', outcome: 'auth-fail' });
    // Another address prefix is counted apart.
    expect((await t.signIn.signIn(EMAIL, PASSWORD, ctx({ ip: '198.51.100.7' }))).ok).toBe(true);
  });

  it('T-WAUTH-11: reauth checks the sub and creates no session', async () => {
    const t = setup();
    const sub = await confirmed(t.idp);
    const otherSub = await confirmed(t.idp, 'other@example.test');
    const sessionId = await firstSignIn(t);
    // Give the other person an authenticator too.
    await firstSignIn(t, 'other@example.test');
    const before = (await t.container.sessionStore.listBySub(sub)).length;

    const pw = await t.signIn.signIn(EMAIL, PASSWORD, ctx({ reauth: { sub }, sessionId }));
    if (!pw.ok) throw new Error('refused');
    expect(pw.data.next).toBe('/sign-in/code');
    const done = await t.signIn.verifyCode(TEST_AUTHENTICATOR_CODE, ctx({ preAuthId: pw.data.preAuthId, reauth: { sub }, sessionId }));
    expect(done).toEqual({ ok: true, data: { reauthed: true } });
    expect(await t.container.sessionStore.listBySub(sub)).toHaveLength(before);
    expect((await t.sessions.getSession(sessionId))?.sub).toBe(sub);
    expect(await t.sessions.readPreAuth(pw.data.preAuthId)).toBeNull();

    // Someone else's password and code do not reauthenticate this person.
    const theirs = await t.signIn.signIn('other@example.test', PASSWORD, ctx({ reauth: { sub } }));
    if (!theirs.ok) throw new Error('refused');
    const refused = await t.signIn.verifyCode(TEST_AUTHENTICATOR_CODE, ctx({ preAuthId: theirs.data.preAuthId, reauth: { sub } }));
    expect(refused).toEqual({ ok: false, messageKey: 'auth.signIn.errWrong' });
    expect(await t.container.sessionStore.listBySub(otherSub)).toHaveLength(1);

    // A reauth row cannot finish a normal sign-in, and a normal row cannot answer a reauth.
    const again = await t.signIn.signIn(EMAIL, PASSWORD, ctx({ reauth: { sub } }));
    if (!again.ok) throw new Error('refused');
    const mixed = await t.signIn.verifyCode(TEST_AUTHENTICATOR_CODE, ctx({ preAuthId: again.data.preAuthId }));
    expect(mixed).toMatchObject({ ok: false, restart: 'expired' });
  });
});

describe('T-WAUTH-12: an expired challenge returns to the password step; 5 wrong codes start over', () => {
  it('T-WAUTH-12: after 15 minutes the code step answers restart and the row is gone; the password step works again', async () => {
    const t = setup();
    await confirmed(t.idp);
    await firstSignIn(t);
    const pw = await t.signIn.signIn(EMAIL, PASSWORD, ctx());
    if (!pw.ok) throw new Error('refused');
    t.clock.advance(15 * MIN);
    expect(await t.signIn.codeStep(pw.data.preAuthId)).toBe(false);
    expect(await t.signIn.verifyCode(TEST_AUTHENTICATOR_CODE, ctx({ preAuthId: pw.data.preAuthId }))).toEqual({
      ok: false,
      messageKey: 'auth.signIn.errExpired',
      restart: 'expired',
    });
    expect(await t.sessions.readPreAuth(pw.data.preAuthId)).toBeNull();
    const again = await t.signIn.signIn(EMAIL, PASSWORD, ctx());
    expect(again.ok && again.data.next).toBe('/sign-in/code');
  });

  it('T-WAUTH-12: an expired setup returns to the password step and says to remove the old entry', async () => {
    const t = setup();
    await confirmed(t.idp);
    const pw = await t.signIn.signIn(EMAIL, PASSWORD, ctx());
    if (!pw.ok) throw new Error('refused');
    t.clock.advance(15 * MIN);
    expect(await t.signIn.verifySetup(TEST_AUTHENTICATOR_CODE, ctx({ preAuthId: pw.data.preAuthId }))).toEqual({
      ok: false,
      messageKey: 'auth.setup.errExpired',
      restart: 'setup-expired',
    });
  });

  it("T-WAUTH-12: the pool's expired challenge session (bad_session) at setup returns to the password step", async () => {
    const t = setup({ verifySetup: async () => ({ ok: false, reason: 'bad_session' }) });
    await confirmed(t.idp);
    const pw = await t.signIn.signIn(EMAIL, PASSWORD, ctx());
    if (!pw.ok) throw new Error('refused');
    expect(await t.signIn.verifySetup(TEST_AUTHENTICATOR_CODE, ctx({ preAuthId: pw.data.preAuthId }))).toEqual({
      ok: false,
      messageKey: 'auth.setup.errExpired',
      restart: 'setup-expired',
    });
    expect(await t.sessions.readPreAuth(pw.data.preAuthId)).toBeNull();
  });

  it("T-WAUTH-12: the pool's expired challenge session (bad_session) at the code step returns to the password step", async () => {
    const t = setup({ respondCode: async () => ({ ok: false, reason: 'bad_session' }) });
    await confirmed(t.idp);
    await firstSignIn(t);
    const pw = await t.signIn.signIn(EMAIL, PASSWORD, ctx());
    if (!pw.ok) throw new Error('refused');
    expect(pw.data.next).toBe('/sign-in/code');
    expect(await t.signIn.verifyCode(TEST_AUTHENTICATOR_CODE, ctx({ preAuthId: pw.data.preAuthId }))).toEqual({
      ok: false,
      messageKey: 'auth.signIn.errExpired',
      restart: 'expired',
    });
    expect(await t.sessions.readPreAuth(pw.data.preAuthId)).toBeNull();
  });

  it('T-WAUTH-12: 5 wrong codes at the code step start over; the right code after that does not sign in', async () => {
    const t = setup();
    await confirmed(t.idp);
    await firstSignIn(t);
    const pw = await t.signIn.signIn(EMAIL, PASSWORD, ctx());
    if (!pw.ok) throw new Error('refused');
    expect(MAX_CODE_ATTEMPTS).toBe(5);
    for (let i = 1; i < MAX_CODE_ATTEMPTS; i += 1) {
      expect(await t.signIn.verifyCode('999999', ctx({ preAuthId: pw.data.preAuthId }))).toEqual({ ok: false, messageKey: 'auth.code.errWrong' });
    }
    expect(await t.signIn.verifyCode('999999', ctx({ preAuthId: pw.data.preAuthId }))).toEqual({
      ok: false,
      messageKey: 'auth.signIn.errLocked',
      restart: 'locked',
    });
    expect(await t.sessions.readPreAuth(pw.data.preAuthId)).toBeNull();
    expect(await t.signIn.verifyCode(TEST_AUTHENTICATOR_CODE, ctx({ preAuthId: pw.data.preAuthId }))).toMatchObject({
      ok: false,
      restart: 'expired',
    });
    expect(t.logger.events.filter((e) => e.name === 'signin_fail').map((e) => e.outcome)).toEqual([
      'bad_code',
      'bad_code',
      'bad_code',
      'bad_code',
      'locked',
    ]);
  });

  it('T-WAUTH-12: 5 wrong setup codes start over too, and a code that is not 6 digits counts as wrong', async () => {
    const t = setup();
    await confirmed(t.idp);
    const pw = await t.signIn.signIn(EMAIL, PASSWORD, ctx());
    if (!pw.ok) throw new Error('refused');
    const codes = ['12345', 'abcdef', '1234567', '222222'];
    for (const code of codes) {
      expect(await t.signIn.verifySetup(code, ctx({ preAuthId: pw.data.preAuthId }))).toEqual({ ok: false, messageKey: 'auth.setup.errWrong' });
    }
    expect(await t.signIn.verifySetup('333333', ctx({ preAuthId: pw.data.preAuthId }))).toMatchObject({ ok: false, restart: 'locked' });
    expect(await t.sessions.readPreAuth(pw.data.preAuthId)).toBeNull();
  });

  it('T-WAUTH-12: the path after sign-in is kept only when it is a money screen on this site', () => {
    expect(safeNext('/transactions?month=2026-10')).toBe('/transactions?month=2026-10');
    expect(safeNext('/overview')).toBe('/overview');
    for (const bad of [
      undefined,
      '',
      'https://evil.example.test/overview',
      '//evil.example.test',
      '/\\evil',
      '/sign-in',
      '/overview/../x',
      '/consentx',
    ]) {
      expect(safeNext(bad)).toBe('/overview');
    }
  });
});
