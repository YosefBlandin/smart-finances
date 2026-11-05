import { createLimits } from '@/application/limits';
import { createSessions } from '@/application/session';
import { padded, refuse, REPLY_MS, type AuthContext, type AuthDeps, type AuthReply } from './signUp';

// Confirm the sign-up's email code, and send a new one (AC-12, D-106, D-147; the confirm row of "States and exits").
// The pre-auth row from sign-up (step confirm) names the email; without it, or once it expired (15 minutes, D-91), the
// person starts again. A wrong code, an unknown or an already confirmed email all answer errWrong; the 5th wrong code
// ends the step (Contracts "Password and code rules": 5 wrong codes lock the step). A new code goes out only for an
// unconfirmed account and within the code-email cap, yet the reply is always "sent". The right code moves the row on to
// step confirmed, keeping the accepted versions for the first completed sign-in (D-87). Replies take at least REPLY_MS.

export const MAX_CODE_ATTEMPTS = 5;
export const CONFIRMED_STEP = 'confirmed';

export const CONFIRM_MESSAGES = {
  wrong: 'auth.confirm.errWrong',
  expired: 'auth.confirm.errExpired',
  locked: 'auth.confirm.errLocked',
  start: 'auth.confirm.errStart',
} as const;

export function createConfirm(deps: AuthDeps) {
  const { identityProvider, logger } = deps;
  const limits = createLimits(deps);
  const sessions = createSessions(deps);

  async function confirmStep(preAuthId: string | undefined) {
    const row = await sessions.readPreAuth(preAuthId);
    return row?.step === 'confirm' ? row : null;
  }

  async function runConfirm(input: { code: string }, ctx: AuthContext): Promise<AuthReply<{ next: '/sign-in' }>> {
    const { requestId, preAuthId } = ctx;
    const row = await confirmStep(preAuthId);
    if (!row) return refuse(CONFIRM_MESSAGES.start);

    const result = await identityProvider.confirm(row.email, input.code);
    if (result.ok) {
      await sessions.updatePreAuth(preAuthId, { step: CONFIRMED_STEP, attempts: 0 });
      logger.event('signup_confirm', 'ok', { requestId });
      return { ok: true, data: { next: '/sign-in' } };
    }
    // Every other answer counts as a wrong code, 'failed' included: the pool answers an already confirmed account with
    // NotAuthorizedException, which the adapter reports as 'failed', and that reply must look like a wrong code.
    const attempts = row.attempts + 1;
    if (attempts >= MAX_CODE_ATTEMPTS || result.reason === 'limited') {
      await sessions.endPreAuth(preAuthId);
      logger.event('signup_confirm', 'locked', { requestId });
      return refuse(CONFIRM_MESSAGES.locked);
    }
    await sessions.updatePreAuth(preAuthId, { attempts });
    logger.event('signup_confirm', result.reason === 'expired_code' ? 'expired' : 'bad_code', { requestId });
    return refuse(result.reason === 'expired_code' ? CONFIRM_MESSAGES.expired : CONFIRM_MESSAGES.wrong);
  }

  async function runResend(_input: object, ctx: AuthContext): Promise<AuthReply<{ sent: true }>> {
    const { requestId, preAuthId } = ctx;
    const row = await confirmStep(preAuthId);
    if (!row) return refuse(CONFIRM_MESSAGES.start);

    // Only an unconfirmed account gets a code; any other answer is the same "sent".
    const account = await identityProvider.adminGet(row.email);
    if (account.ok && account.status === 'UNCONFIRMED') {
      const cap = await limits.hit('code-email', row.email);
      if (cap.ok) await identityProvider.resend(row.email, row.lang);
      else logger.event('rate_limited', 'code-email', { requestId });
    }
    return { ok: true, data: { sent: true } };
  }

  return {
    confirm: (input: { code: string }, ctx: AuthContext) => padded(deps, REPLY_MS, () => runConfirm(input, ctx)),
    resend: (input: object, ctx: AuthContext) => padded(deps, REPLY_MS, () => runResend(input, ctx)),
  };
}

export type Confirm = ReturnType<typeof createConfirm>;
