import { createLimits } from '@/application/limits';
import { createSessions } from '@/application/session';
import type { BreachChecker } from '@/ports/breach-checker';
import type { Lang } from '@/ports/identity-provider';
import type { PreAuthRow } from '@/ports/pre-auth-store';
import { emailHash, normalizeEmail, padded, passwordLengthOk, refuse, REPLY_MS, type AuthDeps, type AuthReply } from './signUp';

// Reset the password (AC-20, D-92, D-117, D-122; architecture.md "Auth flows" and the reset rows of "States and exits").
//  1. forgot(email): the same reply, the same timing and a pre-auth row (step reset) for any email, known or not; a code
//     email goes out within the code-email cap (3 an hour, 10 a day per email; over it, no email and the same reply).
//  2. confirm(code, password): the sign-in or reset failures counter for the email and address prefix (5 per 15
//     minutes; every post counts, as at sign-in, because the Counter port can only count), the length rule, then the
//     breach check: breached is refused; 'unavailable' accepts the password and logs breach_check_unavailable with the
//     request id (D-117, owner decision on the SF-146 deviation). Then the pool's confirmForgot. A wrong code keeps the
//     step until the 5th (Contracts "Password and code rules"). A changed password signs the person out everywhere: the
//     pool's global sign-out and every session row of the sub (D-92). The reply names the notice that the next sign-in
//     screen shows for 10 minutes, and the reset is logged as a security event (D-122, until SES sends the email).
// The new password does not sign anyone in: the next sign-in still asks for the authenticator code (AC-20).

export const RESET_STEP = 'reset';
export const MAX_RESET_ATTEMPTS = 5;

/** The notice the sign-in screen shows after a reset (D-122): an HttpOnly cookie for 10 minutes. */
export const RESET_NOTICE = { cookie: '__Host-notice', value: 'password-changed', maxAgeSeconds: 600 } as const;

export const RESET_MESSAGES = {
  wrong: 'auth.resetConfirm.errWrong',
  locked: 'auth.resetConfirm.errLocked',
  start: 'auth.resetConfirm.errStart',
  weak: 'auth.signUp.errWeak',
  limited: 'auth.limited',
  unavailable: 'auth.unavailable',
} as const;

export type ResetContext = {
  requestId: string;
  /** The client address (right-most X-Forwarded-For entry), for the failure counter. */
  ip: string | undefined;
  /** The __Host-pre value, when the browser has one. */
  preAuthId?: string;
  /** The language of the code email. */
  lang: Lang;
};

export type ResetDeps = AuthDeps & { breachChecker: BreachChecker };

const isSixDigits = (code: string) => /^\d{6}$/.test(code);

export function createReset(deps: ResetDeps) {
  const { identityProvider, breachChecker, logger } = deps;
  const limits = createLimits(deps);
  const sessions = createSessions(deps);

  /** A code email for the email, within the cap; the pool answers an unknown email like a known one, and so do we. */
  async function sendCode(email: string, lang: Lang, requestId: string) {
    const cap = await limits.hit('code-email', email);
    if (!cap.ok) {
      logger.event('rate_limited', 'code-email', { requestId });
      return;
    }
    await identityProvider.forgot(email, lang);
  }

  async function runForgot(input: { email: string }, ctx: ResetContext): Promise<AuthReply<{ preAuthId: string; email: string }>> {
    const email = normalizeEmail(input.email);
    await sendCode(email, ctx.lang, ctx.requestId);
    logger.event('reset', 'requested', { requestId: ctx.requestId });
    const { id } = await sessions.startPreAuth({ step: RESET_STEP, email, emailHash: emailHash(email), lang: ctx.lang }, ctx.preAuthId);
    return { ok: true, data: { preAuthId: id, email } };
  }

  /** The live reset row behind __Host-pre, or null. */
  async function step(preAuthId: string | undefined): Promise<PreAuthRow | null> {
    const row = await sessions.readPreAuth(preAuthId);
    return row?.step === RESET_STEP ? row : null;
  }

  async function wrongCode(row: PreAuthRow, ctx: ResetContext): Promise<AuthReply<never>> {
    const attempts = row.attempts + 1;
    if (attempts >= MAX_RESET_ATTEMPTS) {
      await sessions.endPreAuth(ctx.preAuthId);
      logger.event('reset', 'locked', { requestId: ctx.requestId });
      return refuse(RESET_MESSAGES.locked);
    }
    await sessions.updatePreAuth(ctx.preAuthId, { attempts });
    logger.event('reset', 'bad_code', { requestId: ctx.requestId });
    return refuse(RESET_MESSAGES.wrong);
  }

  async function runConfirm(
    input: { code: string; password: string },
    ctx: ResetContext,
  ): Promise<AuthReply<{ next: '/sign-in'; notice?: typeof RESET_NOTICE.value }>> {
    const { requestId } = ctx;
    const row = await step(ctx.preAuthId);
    if (!row) return refuse(RESET_MESSAGES.start);

    const fail = await limits.hit('auth-fail', { email: row.email, ip: ctx.ip });
    if (!fail.ok) {
      logger.event('rate_limited', 'auth-fail', { requestId });
      return { ok: false, messageKey: RESET_MESSAGES.limited, retryAfterSeconds: fail.retryAfterSeconds };
    }

    const code = input.code.trim();
    if (!isSixDigits(code)) return wrongCode(row, ctx);
    if (!passwordLengthOk(input.password)) return refuse(RESET_MESSAGES.weak);

    const breached = await breachChecker.isBreached(input.password);
    if (breached === 'unavailable') {
      logger.event('breach_check_unavailable', 'unavailable', { requestId });
    } else if (breached) {
      logger.event('breached_password', 'refused', { requestId });
      return refuse(RESET_MESSAGES.weak);
    }

    const changed = await identityProvider.confirmForgot(row.email, code, input.password);
    if (!changed.ok) {
      switch (changed.reason) {
        case 'bad_code':
        case 'expired_code':
        case 'not_found':
          // An unknown email has no code to match: it reads as a wrong code, like a known one.
          return wrongCode(row, ctx);
        case 'bad_password':
          return refuse(RESET_MESSAGES.weak);
        case 'limited':
          await sessions.endPreAuth(ctx.preAuthId);
          logger.event('reset', 'locked', { requestId });
          return refuse(RESET_MESSAGES.locked);
        default:
          return refuse(RESET_MESSAGES.unavailable);
      }
    }

    // The password changed: everyone is signed out, everywhere (D-92), tried twice. A failure cannot undo the change, so
    // it is logged for the owner and the person still goes on to sign in with the new password, but without the notice
    // that says every session ended, since that would not be true.
    await sessions.endPreAuth(ctx.preAuthId);
    const sub = await signOutEverywhere(row.email);
    if (!sub) {
      logger.event('reset', 'signout_failed', { requestId });
      return { ok: true, data: { next: '/sign-in' } };
    }
    logger.event('reset', 'ok', { requestId, sub });
    return { ok: true, data: { next: '/sign-in', notice: RESET_NOTICE.value } };
  }

  /** The pool's global sign-out and every session row of the person, with one retry; the sub when both worked. */
  async function signOutEverywhere(email: string): Promise<string | undefined> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const account = await identityProvider.adminGet(email);
        if (!account.ok) continue;
        const out = await sessions.signOutEverywhere(account.sub);
        if (out.ok) return account.sub;
      } catch {
        // A thrown SDK error counts as a failed attempt.
      }
    }
    return undefined;
  }

  async function runResend(ctx: ResetContext): Promise<AuthReply<{ sent: true }>> {
    const row = await step(ctx.preAuthId);
    if (!row) return refuse(RESET_MESSAGES.start);
    await sendCode(row.email, row.lang, ctx.requestId);
    return { ok: true, data: { sent: true } };
  }

  return {
    forgot: (input: { email: string }, ctx: ResetContext) => padded(deps, REPLY_MS, () => runForgot(input, ctx)),
    confirm: (input: { code: string; password: string }, ctx: ResetContext) => padded(deps, REPLY_MS, () => runConfirm(input, ctx)),
    resend: (ctx: ResetContext) => padded(deps, REPLY_MS, () => runResend(ctx)),
    step,
  };
}

export type Reset = ReturnType<typeof createReset>;
