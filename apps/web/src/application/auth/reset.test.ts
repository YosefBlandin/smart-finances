/* eslint-disable import/no-restricted-paths -- T-WAUTH-14 and T-WAUTH-15 drive the reset and sign-out use cases over
   the memory adapters (the STAGE=test container), and T-WAUTH-15 the Sign out server action of app/(app)/actions.ts,
   which is the task's one test file; no production application code imports adapters or app/. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getContainer, memoryContainer, type Container } from '@/adapters/container';
import type { MemoryBreachChecker } from '@/adapters/memory/breach-checker';
import { MemoryClock } from '@/adapters/memory/clock';
import { TEST_AUTHENTICATOR_CODE, TEST_EMAIL_CODE, type MemoryIdentityProvider } from '@/adapters/memory/identity-provider';
import type { MemoryLogger } from '@/adapters/memory/logger';
import { createSessions, sessionIdHash } from '@/application/session';
import { createReset, MAX_RESET_ATTEMPTS, RESET_MESSAGES, RESET_NOTICE, RESET_STEP } from './reset';
import { createSignIn } from './signIn';
import { createSignOut } from './signOut';
import { REPLY_MS } from './signUp';
import { signOutAction } from '@/app/(app)/actions';
import { TEST_SETTINGS } from '@/adapters/memory/settings';
import { SESSION_COOKIE } from '@/domain/session-policy';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/legal/versions';

// The Sign out server action reads the request headers and __Host-sid through next/headers; here both are in memory.
const { request } = vi.hoisted(() => ({
  request: {
    headers: new Headers(),
    jar: new Map<string, string>(),
    sets: [] as { name: string; value: string; maxAge?: number }[],
  },
}));
vi.mock('next/headers', () => ({
  headers: async () => request.headers,
  cookies: async () => ({
    get: (name: string) => (request.jar.has(name) ? { name, value: request.jar.get(name) } : undefined),
    set: (name: string, value: string, opts: { maxAge?: number } = {}) => {
      request.sets.push({ name, value, maxAge: opts.maxAge });
      if (opts.maxAge === 0) request.jar.delete(name);
      else request.jar.set(name, value);
    },
  }),
}));

// T-WAUTH-14 (AC-20, D-92, D-122), T-WAUTH-15 (AC-16) and the reset half of T-WAUTH-8's logging (D-117, owner decision
// on the SF-146 deviation): forgot, confirm and sign-out as use cases over the memory adapters. Synthetic addresses only;
// the fake's email code is 123456 and its authenticator code 000000.

const START = Date.UTC(2026, 10, 4, 10, 0, 0);
const EMAIL = 'person@example.test';
const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'another long pass phrase';
const IP = '192.0.2.10';
const MIN = 60_000;

function setup() {
  const clock = new MemoryClock(START);
  const container: Container = memoryContainer(undefined, clock);
  const idp = container.identityProvider as MemoryIdentityProvider;
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
    clock.advance(ms);
  };
  const deps = { ...container, sleep };
  return {
    clock,
    container,
    idp,
    sleeps,
    reset: createReset(deps),
    signIn: createSignIn(deps),
    signOut: createSignOut(deps),
    sessions: createSessions(container),
    logger: container.logger as MemoryLogger,
    breach: container.breachChecker as MemoryBreachChecker,
  };
}
type T = ReturnType<typeof setup>;

const ctx = (extra: Record<string, unknown> = {}) => ({ requestId: 'req-1', ip: IP, lang: 'en' as const, ...extra });
/** The sign-ins that open the sessions come from another address prefix, so they do not count against the reset posts. */
const SIGN_IN_IP = { ip: '203.0.113.5' };

/** A confirmed account with an authenticator and one open session (the first sign-in): its sub and __Host-sid value. */
async function signedIn(t: T, email = EMAIL) {
  await t.idp.signUp(email, PASSWORD, 'en');
  await t.idp.confirm(email, TEST_EMAIL_CODE);
  const pw = await t.signIn.signIn(email, PASSWORD, ctx(SIGN_IN_IP));
  if (!pw.ok) throw new Error(`password step refused: ${pw.messageKey}`);
  const done = await t.signIn.verifySetup(TEST_AUTHENTICATOR_CODE, ctx({ ...SIGN_IN_IP, preAuthId: pw.data.preAuthId }));
  if (!done.ok || !('sessionId' in done.data)) throw new Error('setup refused');
  return { sub: done.data.sub, sessionId: done.data.sessionId };
}

/** A later sign-in (password and code) of an account that has an authenticator: a second session. */
async function secondSession(t: T, password = PASSWORD, email = EMAIL) {
  const pw = await t.signIn.signIn(email, password, ctx(SIGN_IN_IP));
  if (!pw.ok) throw new Error(`password step refused: ${pw.messageKey}`);
  const done = await t.signIn.verifyCode(TEST_AUTHENTICATOR_CODE, ctx({ ...SIGN_IN_IP, preAuthId: pw.data.preAuthId }));
  if (!done.ok || !('sessionId' in done.data)) throw new Error('code refused');
  return done.data.sessionId;
}

/** Forgot then the right code with a new password; answers the confirm reply. */
async function fullReset(t: T, password = NEW_PASSWORD, email = EMAIL) {
  const asked = await t.reset.forgot({ email }, ctx({ requestId: 'req-forgot' }));
  if (!asked.ok) throw new Error(`forgot refused: ${asked.messageKey}`);
  return t.reset.confirm({ code: TEST_EMAIL_CODE, password }, ctx({ requestId: 'req-reset', preAuthId: asked.data.preAuthId }));
}

async function refreshTokenOf(t: T, sessionId: string) {
  const row = await t.container.sessionStore.get(sessionIdHash(sessionId));
  if (!row) throw new Error('no session row');
  return row.refreshToken;
}

describe('T-WAUTH-14: after a reset, sessions opened before it are refused and the authenticator is still asked', () => {
  it('T-WAUTH-14: every session opened before the reset is refused, its rows are gone and its refresh tokens revoked (D-92)', async () => {
    const t = setup();
    const { sub, sessionId } = await signedIn(t);
    const other = await secondSession(t);
    const refreshTokens = [await refreshTokenOf(t, sessionId), await refreshTokenOf(t, other)];
    expect(await t.container.sessionStore.listBySub(sub)).toHaveLength(2);

    const done = await fullReset(t);
    expect(done).toEqual({ ok: true, data: { next: '/sign-in', notice: RESET_NOTICE.value } });

    expect(await t.sessions.getSession(sessionId)).toBeNull();
    expect(await t.sessions.getSession(other)).toBeNull();
    expect(await t.container.sessionStore.listBySub(sub)).toEqual([]);
    for (const token of refreshTokens) expect(await t.idp.refresh(sub, token)).toEqual({ ok: false, reason: 'revoked' });
  });

  it('T-WAUTH-14: the new password works, the old one does not, and sign-in still asks for the authenticator code', async () => {
    const t = setup();
    await signedIn(t);
    await fullReset(t);

    const old = await t.signIn.signIn(EMAIL, PASSWORD, ctx({ requestId: 'req-old' }));
    expect(old).toEqual({ ok: false, messageKey: 'auth.signIn.errWrong' });
    const pw = await t.signIn.signIn(EMAIL, NEW_PASSWORD, ctx({ requestId: 'req-new' }));
    expect(pw.ok && pw.data.next).toBe('/sign-in/code');
    if (!pw.ok) return;
    // No session before the code.
    const got = await t.idp.adminGet(EMAIL);
    expect(got.ok && (await t.container.sessionStore.listBySub(got.sub))).toEqual([]);
    const done = await t.signIn.verifyCode(TEST_AUTHENTICATOR_CODE, ctx({ preAuthId: pw.data.preAuthId }));
    expect(done.ok && 'sessionId' in done.data).toBe(true);
  });

  it('T-WAUTH-14: the reset ends its pre-auth row, logs reset ok with the sub (D-122) and names the 10-minute notice', async () => {
    const t = setup();
    const { sub } = await signedIn(t);
    const asked = await t.reset.forgot({ email: 'Person@Example.test ' }, ctx({ requestId: 'req-forgot' }));
    if (!asked.ok) throw new Error('forgot refused');
    const row = await t.sessions.readPreAuth(asked.data.preAuthId);
    expect(row).toMatchObject({ step: RESET_STEP, email: EMAIL, attempts: 0, lang: 'en' });

    const done = await t.reset.confirm(
      { code: TEST_EMAIL_CODE, password: NEW_PASSWORD },
      ctx({ requestId: 'req-reset', preAuthId: asked.data.preAuthId }),
    );
    expect(done.ok).toBe(true);
    expect(await t.sessions.readPreAuth(asked.data.preAuthId)).toBeNull();
    expect(t.logger.events.filter((e) => e.name === 'reset')).toEqual([
      { name: 'reset', outcome: 'requested', sub: undefined, requestId: 'req-forgot' },
      { name: 'reset', outcome: 'ok', sub, requestId: 'req-reset' },
    ]);
    expect(RESET_NOTICE).toEqual({ cookie: '__Host-notice', value: 'password-changed', maxAgeSeconds: 600 });
  });

  it('T-WAUTH-14: when signing out everywhere fails twice, the reply names no notice and reset signout_failed is logged once (D-92)', async () => {
    const t = setup();
    await signedIn(t);
    const adminGet = vi.spyOn(t.idp, 'adminGet').mockResolvedValue({ ok: false, reason: 'failed' });
    const done = await fullReset(t);
    expect(done).toEqual({ ok: true, data: { next: '/sign-in' } });
    expect(adminGet).toHaveBeenCalledTimes(2);
    expect(t.logger.events.filter((e) => e.name === 'reset' && e.outcome !== 'requested')).toEqual([
      { name: 'reset', outcome: 'signout_failed', sub: undefined, requestId: 'req-reset' },
    ]);
  });

  it('T-WAUTH-14: a global sign-out that fails once is tried again; when the retry works the notice is named and the rows are gone', async () => {
    const t = setup();
    const { sub, sessionId } = await signedIn(t);
    const real = t.idp.adminGlobalSignOut.bind(t.idp);
    const signOut = vi
      .spyOn(t.idp, 'adminGlobalSignOut')
      .mockResolvedValueOnce({ ok: false, reason: 'failed' } as never)
      .mockImplementation(real);
    const done = await fullReset(t);
    expect(done).toEqual({ ok: true, data: { next: '/sign-in', notice: RESET_NOTICE.value } });
    expect(signOut).toHaveBeenCalledTimes(2);
    expect(await t.sessions.getSession(sessionId)).toBeNull();
    expect(t.logger.events.filter((e) => e.name === 'reset' && e.outcome !== 'requested')).toEqual([
      { name: 'reset', outcome: 'ok', sub, requestId: 'req-reset' },
    ]);
  });

  it('T-WAUTH-14: forgot gives the same reply, timing and pre-auth row for a known and an unknown email; only the known one gets a code', async () => {
    const t = setup();
    await signedIn(t);
    const t0 = t.clock.now();
    const known = await t.reset.forgot({ email: EMAIL }, ctx({ requestId: 'req-a' }));
    const knownMs = t.clock.now() - t0;
    const t1 = t.clock.now();
    const unknown = await t.reset.forgot({ email: 'nobody@example.test' }, ctx({ requestId: 'req-b' }));
    const unknownMs = t.clock.now() - t1;

    expect(known.ok && unknown.ok).toBe(true);
    if (!known.ok || !unknown.ok) return;
    expect(Object.keys(known.data).sort()).toEqual(Object.keys(unknown.data).sort());
    expect(known.data.email).toBe(EMAIL);
    expect(unknown.data.email).toBe('nobody@example.test');
    expect(knownMs).toBeGreaterThanOrEqual(REPLY_MS);
    expect(unknownMs).toBeGreaterThanOrEqual(REPLY_MS);
    expect(await t.sessions.readPreAuth(unknown.data.preAuthId)).toMatchObject({ step: RESET_STEP, email: 'nobody@example.test' });
    expect(t.idp.codeEmails.filter((m) => m.kind === 'forgot')).toEqual([{ email: EMAIL, kind: 'forgot', lang: 'en' }]);
  });

  it('T-WAUTH-14: reset code emails are capped at 3 an hour per email; over the cap the reply is the same and no email goes out', async () => {
    const t = setup();
    await signedIn(t);
    const replies = [];
    for (let i = 0; i < 4; i += 1) replies.push(await t.reset.forgot({ email: EMAIL }, ctx({ requestId: `req-${i}`, lang: 'es' })));
    expect(replies.every((r) => r.ok)).toBe(true);
    expect(t.idp.codeEmails.filter((m) => m.kind === 'forgot')).toHaveLength(3);
    expect(t.idp.codeEmails.at(-1)).toEqual({ email: EMAIL, kind: 'forgot', lang: 'es' });
    expect(t.logger.events.filter((e) => e.name === 'rate_limited')).toEqual([
      { name: 'rate_limited', outcome: 'code-email', sub: undefined, requestId: 'req-3' },
    ]);
  });

  it('T-WAUTH-14: "Send a new code" on the confirm screen sends within the cap and always answers sent', async () => {
    const t = setup();
    await signedIn(t);
    const asked = await t.reset.forgot({ email: EMAIL }, ctx());
    if (!asked.ok) throw new Error('forgot refused');
    expect(await t.reset.resend(ctx({ preAuthId: asked.data.preAuthId }))).toEqual({ ok: true, data: { sent: true } });
    expect(t.idp.codeEmails.filter((m) => m.kind === 'forgot')).toHaveLength(2);
    expect(await t.reset.resend(ctx({ preAuthId: undefined }))).toEqual({ ok: false, messageKey: RESET_MESSAGES.start });
  });

  it('T-WAUTH-14: a wrong code keeps the step; the 5th ends it and the password stays unchanged', async () => {
    const t = setup();
    const { sessionId } = await signedIn(t);
    const asked = await t.reset.forgot({ email: EMAIL }, ctx());
    if (!asked.ok) throw new Error('forgot refused');
    const preAuthId = asked.data.preAuthId;
    for (let i = 1; i < MAX_RESET_ATTEMPTS; i += 1) {
      expect(await t.reset.confirm({ code: '654321', password: NEW_PASSWORD }, ctx({ preAuthId }))).toEqual({
        ok: false,
        messageKey: RESET_MESSAGES.wrong,
      });
      expect((await t.sessions.readPreAuth(preAuthId))?.attempts).toBe(i);
    }
    expect(await t.reset.confirm({ code: 'abc', password: NEW_PASSWORD }, ctx({ preAuthId }))).toEqual({
      ok: false,
      messageKey: RESET_MESSAGES.locked,
    });
    expect(await t.sessions.readPreAuth(preAuthId)).toBeNull();
    expect(await t.reset.confirm({ code: TEST_EMAIL_CODE, password: NEW_PASSWORD }, ctx({ preAuthId }))).toEqual({
      ok: false,
      messageKey: RESET_MESSAGES.start,
    });
    expect((await t.idp.passwordAuth(EMAIL, PASSWORD)).ok).toBe(true);
    expect(await t.sessions.getSession(sessionId)).not.toBeNull();
  });

  it('T-WAUTH-14: the 6th confirm post in 15 minutes for one email and address prefix is refused with the wait', async () => {
    const t = setup();
    await signedIn(t);
    const asked = await t.reset.forgot({ email: EMAIL }, ctx());
    if (!asked.ok) throw new Error('forgot refused');
    const again = await t.reset.forgot({ email: EMAIL }, ctx());
    if (!again.ok) throw new Error('forgot refused');
    for (let i = 0; i < 4; i += 1) await t.reset.confirm({ code: '654321', password: NEW_PASSWORD }, ctx({ preAuthId: asked.data.preAuthId }));
    // The 5th post of the first row locks it; a new row (the second forgot) still meets the counter.
    await t.reset.confirm({ code: '654321', password: NEW_PASSWORD }, ctx({ preAuthId: again.data.preAuthId }));
    const limited = await t.reset.confirm(
      { code: TEST_EMAIL_CODE, password: NEW_PASSWORD },
      ctx({ requestId: 'req-6', preAuthId: again.data.preAuthId }),
    );
    expect(limited.ok).toBe(false);
    if (limited.ok) return;
    expect(limited.messageKey).toBe(RESET_MESSAGES.limited);
    expect(limited.retryAfterSeconds).toBeGreaterThan(0);
    expect(t.logger.events.filter((e) => e.name === 'rate_limited')).toContainEqual({
      name: 'rate_limited',
      outcome: 'auth-fail',
      sub: undefined,
      requestId: 'req-6',
    });
    expect((await t.idp.passwordAuth(EMAIL, PASSWORD)).ok).toBe(true);
  });

  it('T-WAUTH-14: a short or a breached new password is refused, nothing changes and no one is signed out', async () => {
    const t = setup();
    const { sessionId } = await signedIn(t);
    const asked = await t.reset.forgot({ email: EMAIL }, ctx());
    if (!asked.ok) throw new Error('forgot refused');
    const preAuthId = asked.data.preAuthId;
    expect(await t.reset.confirm({ code: TEST_EMAIL_CODE, password: 'short pass' }, ctx({ preAuthId }))).toEqual({
      ok: false,
      messageKey: RESET_MESSAGES.weak,
    });
    t.breach.add(NEW_PASSWORD);
    expect(await t.reset.confirm({ code: TEST_EMAIL_CODE, password: NEW_PASSWORD }, ctx({ requestId: 'req-b', preAuthId }))).toEqual({
      ok: false,
      messageKey: RESET_MESSAGES.weak,
    });
    expect(t.logger.events.filter((e) => e.name === 'breached_password')).toEqual([
      { name: 'breached_password', outcome: 'refused', sub: undefined, requestId: 'req-b' },
    ]);
    expect((await t.idp.passwordAuth(EMAIL, PASSWORD)).ok).toBe(true);
    expect(await t.sessions.getSession(sessionId)).not.toBeNull();
    // The step is kept: a refused password is not a wrong code.
    expect((await t.sessions.readPreAuth(preAuthId))?.attempts).toBe(0);
  });

  it('T-WAUTH-14: without a live reset row (none, expired after 15 minutes, or another step) the person starts again', async () => {
    const t = setup();
    await signedIn(t);
    expect(await t.reset.confirm({ code: TEST_EMAIL_CODE, password: NEW_PASSWORD }, ctx())).toEqual({ ok: false, messageKey: RESET_MESSAGES.start });
    const asked = await t.reset.forgot({ email: EMAIL }, ctx());
    if (!asked.ok) throw new Error('forgot refused');
    t.clock.advance(15 * MIN);
    expect(await t.reset.confirm({ code: TEST_EMAIL_CODE, password: NEW_PASSWORD }, ctx({ preAuthId: asked.data.preAuthId }))).toEqual({
      ok: false,
      messageKey: RESET_MESSAGES.start,
    });
    const pw = await t.signIn.signIn(EMAIL, PASSWORD, ctx());
    if (!pw.ok) throw new Error('password step refused');
    expect(await t.reset.confirm({ code: TEST_EMAIL_CODE, password: NEW_PASSWORD }, ctx({ preAuthId: pw.data.preAuthId }))).toEqual({
      ok: false,
      messageKey: RESET_MESSAGES.start,
    });
    expect(await t.reset.step(pw.data.preAuthId)).toBeNull();
  });
});

describe('T-WAUTH-8: the breach check in reset (logging half; owner decision on the SF-146 deviation)', () => {
  it('T-WAUTH-8: when the checker answers unavailable, the new password is accepted and breach_check_unavailable is logged once with the request id', async () => {
    const t = setup();
    const { sub } = await signedIn(t);
    t.breach.setUnavailable(true);
    const done = await fullReset(t);
    expect(done.ok).toBe(true);
    expect(t.logger.events.filter((e) => e.name === 'breach_check_unavailable')).toEqual([
      { name: 'breach_check_unavailable', outcome: 'unavailable', sub: undefined, requestId: 'req-reset' },
    ]);
    expect((await t.idp.passwordAuth(EMAIL, NEW_PASSWORD)).ok).toBe(true);
    expect(await t.container.sessionStore.listBySub(sub)).toEqual([]);
  });

  it('T-WAUTH-8: an available check that finds nothing logs no breach event', async () => {
    const t = setup();
    await signedIn(t);
    await fullReset(t);
    expect(t.logger.events.filter((e) => e.name === 'breach_check_unavailable' || e.name === 'breached_password')).toEqual([]);
  });
});

describe('T-WAUTH-15: sign-out removes the row and revokes the refresh token', () => {
  it('T-WAUTH-15: sign-out deletes this session row, revokes its refresh token and logs signout ok with the sub', async () => {
    const t = setup();
    const { sub, sessionId } = await signedIn(t);
    const other = await secondSession(t);
    const token = await refreshTokenOf(t, sessionId);

    expect(await t.signOut(sessionId, { requestId: 'req-out' })).toEqual({ ok: true, data: { next: '/sign-in' } });
    expect(await t.container.sessionStore.get(sessionIdHash(sessionId))).toBeUndefined();
    expect(await t.sessions.getSession(sessionId)).toBeNull();
    expect(await t.idp.refresh(sub, token)).toEqual({ ok: false, reason: 'revoked' });
    expect(t.logger.events.filter((e) => e.name === 'signout')).toEqual([{ name: 'signout', outcome: 'ok', sub, requestId: 'req-out' }]);
    // Only this browser's session ends; the other device stays signed in.
    expect(await t.sessions.getSession(other)).not.toBeNull();
    expect((await t.idp.refresh(sub, await refreshTokenOf(t, other))).ok).toBe(true);
  });

  it('T-WAUTH-15: signing out of a session already idle for 30 minutes still revokes its refresh token', async () => {
    const t = setup();
    const { sub, sessionId } = await signedIn(t);
    const token = await refreshTokenOf(t, sessionId);
    t.clock.advance(31 * MIN);
    expect(await t.signOut(sessionId, { requestId: 'req-idle' })).toEqual({ ok: true, data: { next: '/sign-in' } });
    expect(await t.container.sessionStore.get(sessionIdHash(sessionId))).toBeUndefined();
    expect(await t.idp.refresh(sub, token)).toEqual({ ok: false, reason: 'revoked' });
  });

  it('T-WAUTH-15: sign-out without a cookie, with a malformed one or a second time does nothing and still answers sign-in', async () => {
    const t = setup();
    const { sessionId } = await signedIn(t);
    expect(await t.signOut(undefined, { requestId: 'req-1' })).toEqual({ ok: true, data: { next: '/sign-in' } });
    expect(await t.signOut('not-a-cookie-id', { requestId: 'req-2' })).toEqual({ ok: true, data: { next: '/sign-in' } });
    expect(await t.sessions.getSession(sessionId)).not.toBeNull();
    await t.signOut(sessionId, { requestId: 'req-3' });
    expect(await t.signOut(sessionId, { requestId: 'req-4' })).toEqual({ ok: true, data: { next: '/sign-in' } });
    expect(t.logger.events.filter((e) => e.name === 'signout').map((e) => e.outcome)).toEqual(['ok']);
  });
});

describe('T-WAUTH-15: the Sign out row posts a server action (guarded money, allowDeleting; owner decision on the SF-151 deviation)', () => {
  const SHARED = Symbol.for('smart-finances.container');
  const ORIGIN = TEST_SETTINGS.WEB_ORIGIN;

  afterEach(() => {
    vi.unstubAllEnvs();
    delete (globalThis as Record<symbol, unknown>)[SHARED];
    request.headers = new Headers();
    request.jar.clear();
    request.sets = [];
  });

  /** The STAGE=test shared container (the one the action uses) with one signed-in person; their cookie is set. */
  async function signedInShared() {
    vi.stubEnv('STAGE', 'test');
    const container = getContainer();
    const idp = container.identityProvider as MemoryIdentityProvider;
    const deps = { ...container, sleep: async () => {} };
    const signIn = createSignIn(deps);
    await idp.signUp(EMAIL, PASSWORD, 'en');
    await idp.confirm(EMAIL, TEST_EMAIL_CODE);
    const pw = await signIn.signIn(EMAIL, PASSWORD, ctx(SIGN_IN_IP));
    if (!pw.ok) throw new Error(`password step refused: ${pw.messageKey}`);
    const done = await signIn.verifySetup(TEST_AUTHENTICATOR_CODE, ctx({ ...SIGN_IN_IP, preAuthId: pw.data.preAuthId }));
    if (!done.ok || !('sessionId' in done.data)) throw new Error('setup refused');
    // Consent at the current versions, so the money guard lets the post through.
    await createGuardConsent(container, done.data.sub);
    request.jar.set(SESSION_COOKIE, done.data.sessionId);
    request.headers = new Headers({ origin: ORIGIN, 'x-forwarded-for': '198.51.100.7' });
    const row = await container.sessionStore.get(sessionIdHash(done.data.sessionId));
    if (!row) throw new Error('no session row');
    return {
      container,
      idp,
      sub: done.data.sub,
      sessionId: done.data.sessionId,
      refreshToken: row.refreshToken,
      logger: container.logger as MemoryLogger,
    };
  }

  async function createGuardConsent(container: Container, sub: string) {
    await container.accountStore.putConsent(sub, {
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      lang: 'en',
      acceptedAt: Date.now(),
    });
  }

  const redirectTo = (path: string) => ({ digest: expect.stringContaining(`;${path};`) });

  it('T-WAUTH-15: the post deletes the session row, revokes the refresh token, clears __Host-sid and opens /sign-in', async () => {
    const s = await signedInShared();
    await expect(signOutAction(new FormData())).rejects.toMatchObject(redirectTo('/sign-in'));
    expect(await s.container.sessionStore.get(sessionIdHash(s.sessionId))).toBeUndefined();
    expect(await s.idp.refresh(s.sub, s.refreshToken)).toEqual({ ok: false, reason: 'revoked' });
    expect(request.sets).toEqual([{ name: SESSION_COOKIE, value: '', maxAge: 0 }]);
    expect(s.logger.events.filter((e) => e.name === 'signout')).toEqual([
      { name: 'signout', outcome: 'ok', sub: s.sub, requestId: expect.any(String) },
    ]);
  });

  it('T-WAUTH-15: a post with no Origin or another origin ends nothing and clears nothing (D-115)', async () => {
    const s = await signedInShared();
    for (const h of [{}, { origin: 'null' }, { origin: 'https://evil.example.test' }] as Record<string, string>[]) {
      request.headers = new Headers(h);
      await expect(signOutAction(new FormData())).resolves.toBeUndefined();
    }
    expect(await s.container.sessionStore.get(sessionIdHash(s.sessionId))).toBeDefined();
    expect((await s.idp.refresh(s.sub, s.refreshToken)).ok).toBe(true);
    expect(request.sets).toEqual([]);
  });

  it('T-WAUTH-15: a session that already ended still clears __Host-sid and opens sign-in with the idle note', async () => {
    const s = await signedInShared();
    await s.container.sessionStore.delete(sessionIdHash(s.sessionId));
    await expect(signOutAction(new FormData())).rejects.toMatchObject(redirectTo('/sign-in?reason=idle'));
    expect(request.sets).toEqual([{ name: SESSION_COOKIE, value: '', maxAge: 0 }]);
  });

  it('T-WAUTH-15: a session the guard reads as ended because its refresh failed still has its row deleted and its refresh token revoked', async () => {
    const s = await signedInShared();
    const idHash = sessionIdHash(s.sessionId);
    const row = await s.container.sessionStore.get(idHash);
    if (!row) throw new Error('no session row');
    const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const expired = `${part({ alg: 'none' })}.${part({ sub: s.sub, exp: Math.floor(Date.now() / 1000) - 60, token_use: 'access' })}.test`;
    await s.container.sessionStore.delete(idHash);
    await s.container.sessionStore.create({ ...row, accessToken: expired });
    const refresh = vi.spyOn(s.idp, 'refresh').mockResolvedValue({ ok: false, reason: 'failed' });
    await expect(signOutAction(new FormData())).rejects.toMatchObject(redirectTo('/sign-in?reason=idle'));
    refresh.mockRestore();
    expect(await s.container.sessionStore.get(idHash)).toBeUndefined();
    expect(await s.idp.refresh(s.sub, s.refreshToken)).toEqual({ ok: false, reason: 'revoked' });
    expect(request.sets).toEqual([{ name: SESSION_COOKIE, value: '', maxAge: 0 }]);
  });

  it('T-WAUTH-15: an account being deleted can still sign out (allowDeleting, D-104)', async () => {
    const s = await signedInShared();
    await s.container.accountStore.markDeleting(s.sub, Date.now());
    await expect(signOutAction(new FormData())).rejects.toMatchObject(redirectTo('/sign-in'));
    expect(await s.container.sessionStore.get(sessionIdHash(s.sessionId))).toBeUndefined();
    expect(await s.idp.refresh(s.sub, s.refreshToken)).toEqual({ ok: false, reason: 'revoked' });
  });
});
