// @ts-expect-error -- qrcode (a package the brief allows, D-73) ships no types and @types/qrcode is not in the brief's
// Values; the one call used here is typed by QrCore below.
import QRCode from 'qrcode';
import { createLimits } from '@/application/limits';
import { createSessions } from '@/application/session';
import type { Stage } from '@/domain/limits';
import { tokenClaims } from '@/domain/session-policy';
import type { Lang, Tokens } from '@/ports/identity-provider';
import type { PreAuthRow } from '@/ports/pre-auth-store';
import { emailHash, normalizeEmail, padded, refuse, REPLY_MS, type AuthDeps } from './signUp';

// Sign in (AC-1, AC-13, D-72, D-73, D-91; architecture.md "Auth flows" and the password, setup and code rows of "States
// and exits"). Three steps, each a server action; between them the state lives in the pre-auth row (__Host-pre):
//  1. signIn(email, password): the sign-in or reset failures counter for the email and address prefix (5 per 15 minutes;
//     the Counter port can only count, so every password post counts), then the pool's password step. A wrong email or
//     password is one message, padded like sign-up. An unconfirmed account gets a new code within the code-email cap and
//     goes to the confirm screen. A first sign-in (MFA_SETUP) associates a new key at once and goes to setup; a later one
//     (SOFTWARE_TOKEN_MFA) goes to the code. The accepted versions of a confirmed sign-up row for the same email carry
//     over, for the consent written at the first completed sign-in (D-87, SF-150).
//  2. verifySetup(code): the first code from the new key; the pool then answers the MFA_SETUP challenge with tokens.
//  3. verifyCode(code): the authenticator code of a later sign-in.
// A wrong code keeps the step (and the key); the 5th wrong code, the pool's lock, an expired row (15 minutes) or an
// expired challenge session end the row and send the person back to the password step. Success creates a new session
// (a new __Host-sid id; the previous session of this browser and the pre-auth row go). No session exists before the
// code. reauth mode (delete account, D-104) checks that the code belongs to the signed-in sub and creates no session.

export const MAX_CODE_ATTEMPTS = 5;
export const SETUP_STEP = 'setup';
export const CODE_STEP = 'code';
export const REAUTH_STEP = 'reauth-code';

export const SIGN_IN_MESSAGES = {
  wrong: 'auth.signIn.errWrong',
  expired: 'auth.signIn.errExpired',
  locked: 'auth.signIn.errLocked',
  setupWrong: 'auth.setup.errWrong',
  setupExpired: 'auth.setup.errExpired',
  codeWrong: 'auth.code.errWrong',
  limited: 'auth.limited',
  unavailable: 'auth.unavailable',
} as const;

/** Where a refused step sends the person: back to the password step, with the reason the sign-in screen shows. */
export type Restart = 'expired' | 'setup-expired' | 'locked';

export type SignInContext = {
  requestId: string;
  /** The client address (right-most X-Forwarded-For entry), for the failure counter. */
  ip: string | undefined;
  /** The __Host-pre value, when the browser has one. */
  preAuthId?: string;
  /** The __Host-sid value, when the browser has one: a completed sign-in replaces that session. */
  sessionId?: string;
  lang: Lang;
  /** Re-sign-in of a signed-in person (delete account, D-104): the code must belong to this sub; no session is created. */
  reauth?: { sub: string };
};

type Refused = { ok: false; messageKey: string; retryAfterSeconds?: number };
type RestartRefusal = { ok: false; messageKey: string; restart: Restart };
export type PasswordNext = '/sign-in/setup' | '/sign-in/code' | '/sign-up/confirm';
export type PasswordReply = { ok: true; data: { preAuthId: string; next: PasswordNext } } | Refused;
export type CodeReply = { ok: true; data: { sessionId: string; sub: string; next: '/overview' } | { reauthed: true } } | Refused | RestartRefusal;

// --- The authenticator key on the setup screen --------------------------------------------------------------------

/** The name the authenticator app shows: Cuenta on prod, the stage named elsewhere so test entries stand apart. */
export const issuerFor = (stage: Stage) => (stage === 'prod' ? 'Cuenta' : `Cuenta ${stage}`);

/** The key URI the QR code carries (Google Authenticator key URI format; TOTP, 6 digits, 30 seconds by default). */
export const otpauthUri = (issuer: string, email: string, secret: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;

type QrCore = {
  create(
    text: string,
    opts: { errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H' },
  ): { modules: { size: number; get(row: number, col: number): number | boolean } };
};
const QUIET = 4;

/** The QR code drawn on the server as one SVG path of unit squares, with the 4-module quiet zone (size includes it). */
export function qrPath(text: string): { size: number; path: string } {
  const { modules } = (QRCode as QrCore).create(text, { errorCorrectionLevel: 'M' });
  let path = '';
  for (let row = 0; row < modules.size; row += 1) {
    for (let col = 0; col < modules.size; col += 1) if (modules.get(row, col)) path += `M${col + QUIET} ${row + QUIET}h1v1h-1z`;
  }
  return { size: modules.size + 2 * QUIET, path };
}

// --- After sign-in --------------------------------------------------------------------------------------------------

const MONEY_PATHS = ['/overview', '/transactions', '/review', '/imports', '/rates', '/data'];
const UNSAFE_NEXT = /(^|\/)\.\.?(\/|$)|\/\/|[\\#]|[\u0000-\u001f\u007f]|%/;

/** The path to open after sign-in: the ?next the middleware kept, only when it is a money screen here; else the overview. */
export function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith('/') || UNSAFE_NEXT.test(next)) return '/overview';
  const path = next.split('?')[0] ?? '';
  return MONEY_PATHS.some((p) => path === p || path.startsWith(`${p}/`)) ? next : '/overview';
}

const isSixDigits = (code: string) => /^\d{6}$/.test(code);

export function createSignIn(deps: AuthDeps) {
  const { identityProvider, logger, settings } = deps;
  const limits = createLimits(deps);
  const sessions = createSessions(deps);

  const restart = (messageKey: string, kind: Restart): RestartRefusal => ({ ok: false, messageKey, restart: kind });

  async function passwordStep(rawEmail: string, password: string, ctx: SignInContext): Promise<PasswordReply> {
    const { requestId } = ctx;
    const email = normalizeEmail(rawEmail);

    const fail = await limits.hit('auth-fail', { email, ip: ctx.ip });
    if (!fail.ok) {
      logger.event('rate_limited', 'auth-fail', { requestId });
      return { ok: false, messageKey: SIGN_IN_MESSAGES.limited, retryAfterSeconds: fail.retryAfterSeconds };
    }

    // The accepted versions of this browser's confirmed sign-up, for the same email only.
    const previous = await sessions.readPreAuth(ctx.preAuthId);
    const acceptedVersions = previous?.email === email ? previous.acceptedVersions : undefined;
    const start = (fields: { step: string; challengeSession?: string; totpSecret?: string }) =>
      sessions.startPreAuth(
        { email, emailHash: emailHash(email), lang: ctx.lang, ...(acceptedVersions ? { acceptedVersions } : {}), ...fields },
        ctx.preAuthId,
      );

    const auth = await identityProvider.passwordAuth(email, password);
    if (!auth.ok) {
      if (auth.reason === 'unconfirmed' && !ctx.reauth) {
        // The right password for an account never confirmed: a new code within the cap, then the confirm screen.
        const cap = await limits.hit('code-email', email);
        if (cap.ok) await identityProvider.resend(email, ctx.lang);
        else logger.event('rate_limited', 'code-email', { requestId });
        logger.event('signin', 'unconfirmed', { requestId });
        const { id } = await start({ step: 'confirm' });
        return { ok: true, data: { preAuthId: id, next: '/sign-up/confirm' } };
      }
      if (auth.reason === 'bad_credentials' || auth.reason === 'unconfirmed') {
        logger.event('signin_fail', 'bad_credentials', { requestId });
        return refuse(SIGN_IN_MESSAGES.wrong);
      }
      if (auth.reason === 'limited') {
        logger.event('signin_fail', 'limited', { requestId });
        return refuse(SIGN_IN_MESSAGES.limited);
      }
      return refuse(SIGN_IN_MESSAGES.unavailable);
    }

    if ('tokens' in auth) {
      // The pool requires an authenticator (AC-13); tokens without a challenge mean a misconfigured pool: no session.
      await identityProvider.revoke(auth.tokens.refresh);
      logger.event('signin_fail', 'no_mfa', { requestId });
      return refuse(SIGN_IN_MESSAGES.unavailable);
    }

    if (auth.challenge === 'MFA_SETUP') {
      if (ctx.reauth) {
        // A signed-in person always has an authenticator; another account's password lands here.
        logger.event('signin_fail', 'reauth_setup', { requestId });
        return refuse(SIGN_IN_MESSAGES.wrong);
      }
      const key = await identityProvider.associate(auth.session);
      if (!key.ok) return refuse(SIGN_IN_MESSAGES.unavailable);
      const { id } = await start({ step: SETUP_STEP, challengeSession: key.session, totpSecret: key.secret });
      logger.event('signin', 'setup', { requestId });
      return { ok: true, data: { preAuthId: id, next: '/sign-in/setup' } };
    }

    const { id } = await start({ step: ctx.reauth ? REAUTH_STEP : CODE_STEP, challengeSession: auth.session });
    logger.event('signin', 'code', { requestId });
    return { ok: true, data: { preAuthId: id, next: '/sign-in/code' } };
  }

  /** The sub of the tokens the pool just returned to this server: the id token's claim, else the pool's own record. */
  async function subOf(tokens: Tokens, email: string): Promise<string | undefined> {
    const sub = tokenClaims(tokens.id)?.sub;
    if (typeof sub === 'string' && sub) return sub;
    const got = await identityProvider.adminGet(email);
    return got.ok ? got.sub : undefined;
  }

  async function finish(row: PreAuthRow, tokens: Tokens, ctx: SignInContext, event: 'mfa_setup' | 'signin'): Promise<CodeReply> {
    const { requestId } = ctx;
    const sub = await subOf(tokens, row.email);
    if (!sub) {
      await identityProvider.revoke(tokens.refresh);
      return refuse(SIGN_IN_MESSAGES.unavailable);
    }
    if (ctx.reauth) {
      await identityProvider.revoke(tokens.refresh);
      await sessions.endPreAuth(ctx.preAuthId);
      if (sub !== ctx.reauth.sub) {
        logger.event('signin_fail', 'reauth_mismatch', { requestId, sub: ctx.reauth.sub });
        return refuse(SIGN_IN_MESSAGES.wrong);
      }
      logger.event('signin', 'reauth', { requestId, sub });
      return { ok: true, data: { reauthed: true } };
    }
    if (event === 'mfa_setup') logger.event('mfa_setup', 'ok', { requestId, sub });
    const { id } = await sessions.createSession({ sub, tokens, preAuthId: ctx.preAuthId, previousSessionId: ctx.sessionId });
    logger.event('signin', 'ok', { requestId, sub });
    return { ok: true, data: { sessionId: id, sub, next: '/overview' } };
  }

  /** One wrong code: the step stays (the same key at setup) until the 5th, which ends the row. */
  async function wrongCode(row: PreAuthRow, ctx: SignInContext, event: 'mfa_setup' | 'signin_fail', wrongKey: string): Promise<CodeReply> {
    const attempts = row.attempts + 1;
    if (attempts >= MAX_CODE_ATTEMPTS) {
      await sessions.endPreAuth(ctx.preAuthId);
      logger.event(event, 'locked', { requestId: ctx.requestId });
      return restart(SIGN_IN_MESSAGES.locked, 'locked');
    }
    await sessions.updatePreAuth(ctx.preAuthId, { attempts });
    logger.event(event, 'bad_code', { requestId: ctx.requestId });
    return refuse(wrongKey);
  }

  async function setupStep(rawCode: string, ctx: SignInContext): Promise<CodeReply> {
    const row = await sessions.readPreAuth(ctx.preAuthId);
    if (row?.step !== SETUP_STEP || !row.challengeSession || ctx.reauth) {
      await sessions.endPreAuth(ctx.preAuthId);
      return restart(SIGN_IN_MESSAGES.setupExpired, 'setup-expired');
    }
    const code = rawCode.trim();
    if (!isSixDigits(code)) return wrongCode(row, ctx, 'mfa_setup', SIGN_IN_MESSAGES.setupWrong);
    const result = await identityProvider.verifySetup(row.email, row.challengeSession, code);
    if (result.ok) return finish(row, result.tokens, ctx, 'mfa_setup');
    switch (result.reason) {
      case 'bad_code':
        return wrongCode(row, ctx, 'mfa_setup', SIGN_IN_MESSAGES.setupWrong);
      case 'limited':
        await sessions.endPreAuth(ctx.preAuthId);
        logger.event('mfa_setup', 'locked', { requestId: ctx.requestId });
        return restart(SIGN_IN_MESSAGES.locked, 'locked');
      case 'bad_session':
      case 'expired_code':
        // The pool's challenge session ran out (15 minutes): back to the password step; the old entry is useless.
        await sessions.endPreAuth(ctx.preAuthId);
        logger.event('mfa_setup', 'expired', { requestId: ctx.requestId });
        return restart(SIGN_IN_MESSAGES.setupExpired, 'setup-expired');
      default:
        return refuse(SIGN_IN_MESSAGES.unavailable);
    }
  }

  async function codeStepRun(rawCode: string, ctx: SignInContext): Promise<CodeReply> {
    const row = await sessions.readPreAuth(ctx.preAuthId);
    const wanted = ctx.reauth ? REAUTH_STEP : CODE_STEP;
    if (row?.step !== wanted || !row.challengeSession) {
      await sessions.endPreAuth(ctx.preAuthId);
      return restart(SIGN_IN_MESSAGES.expired, 'expired');
    }
    const code = rawCode.trim();
    if (!isSixDigits(code)) return wrongCode(row, ctx, 'signin_fail', SIGN_IN_MESSAGES.codeWrong);
    const result = await identityProvider.respondCode(row.email, row.challengeSession, code);
    if (result.ok) return finish(row, result.tokens, ctx, 'signin');
    switch (result.reason) {
      case 'bad_code':
        return wrongCode(row, ctx, 'signin_fail', SIGN_IN_MESSAGES.codeWrong);
      case 'limited':
        await sessions.endPreAuth(ctx.preAuthId);
        logger.event('signin_fail', 'locked', { requestId: ctx.requestId });
        return restart(SIGN_IN_MESSAGES.locked, 'locked');
      case 'bad_session':
      case 'expired_code':
        await sessions.endPreAuth(ctx.preAuthId);
        logger.event('signin_fail', 'expired', { requestId: ctx.requestId });
        return restart(SIGN_IN_MESSAGES.expired, 'expired');
      default:
        return refuse(SIGN_IN_MESSAGES.unavailable);
    }
  }

  /** What the setup screen shows: the key, its URI and the QR path; null without a live setup row. */
  async function setupView(preAuthId: string | undefined) {
    const row = await sessions.readPreAuth(preAuthId);
    if (row?.step !== SETUP_STEP || !row.totpSecret) return null;
    const issuer = issuerFor(settings.get().STAGE);
    const uri = otpauthUri(issuer, row.email, row.totpSecret);
    return { email: row.email, secret: row.totpSecret, issuer, uri, qr: qrPath(uri) };
  }

  /** Whether the code screen has a live code row behind it (sign-in or reauth). */
  async function codeStep(preAuthId: string | undefined) {
    const row = await sessions.readPreAuth(preAuthId);
    return row?.step === CODE_STEP || row?.step === REAUTH_STEP;
  }

  return {
    /** signIn(email, password, { reauth? }) of architecture.md "Interfaces between the PRs"; padded like sign-up. */
    signIn: (email: string, password: string, ctx: SignInContext) => padded(deps, REPLY_MS, () => passwordStep(email, password, ctx)),
    verifySetup: setupStep,
    verifyCode: codeStepRun,
    setupView,
    codeStep,
  };
}

export type SignIn = ReturnType<typeof createSignIn>;
