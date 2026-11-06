import { createSignIn, type SignInDeps } from '@/application/auth/signIn';
import { createErase } from '@/application/data/erase';
import { createImports, type ImportsDeps } from '@/application/data/requestImport';
import { createSessions, type Session } from '@/application/session';
import { DELETION_STEPS, goodbyeValue, readGoodbyeValue, type DeletionStep, type Erased, type Goodbye } from '@/domain/deletion';
import type { Lang } from '@/ports/identity-provider';

// Delete the account (SF-169; AC-18, D-104, D-168). Two calls, each behind its own server action:
//  start: a full re-sign-in of the signed-in person, createSignIn(deps).signIn(email, password, { reauth: { sub } })
//    then verifyCode(code) in reauth mode (the code must belong to this sub; no session is created), then no running
//    import (a slot whose import already ended is settled first, as the import use case does), then markDeleting,
//    which is itself conditional on no running import, a placeholder included (AC-18).
//  finish: only for an account marked deleting; runs domain/deletion.ts's steps in order, each tried again within the
//    call before it gives up (erase until 202), and answers the counts or the step that stopped it. Every step is safe
//    to repeat, so calling finish again finishes a deletion that stopped at any step.
// Security events: account_delete started, done or failed_<step>, with the sub and never an email (Contracts
// "Security events"). goodbye and readGoodbye sign and read the goodbye cookie with the stage's HMAC secret.

/** Erase attempts within one finish ("erase until 202"); a repeat of an unfinished erase resumes it (data spec T-ERA-3). */
export const ERASE_ATTEMPTS = 2;
/** Attempts of each later step within one finish. */
export const STEP_ATTEMPTS = 2;

export type DeleteAccountDeps = SignInDeps & ImportsDeps;
export type Reauth = { email: string; password: string; code: string };
export type DeleteContext = { requestId: string; ip: string | undefined; lang: Lang };
export type StartResult = { ok: true } | { ok: false; messageKey: string; retryAfterSeconds?: number };
export type FinishResult =
  { ok: true; erased: Erased } | { ok: false; reason: 'not-deleting' } | { ok: false; reason: 'step'; step: DeletionStep; erased?: Erased };

export const DELETE_MESSAGES = { running: 'auth.delete.running', unavailable: 'auth.unavailable' } as const;

type Who = Pick<Session, 'sub' | 'accessToken'>;

export function createDeleteAccount(deps: DeleteAccountDeps) {
  const { accountStore, identityProvider, logger, clock, secretStore, settings } = deps;
  const signIn = createSignIn(deps);
  const sessions = createSessions(deps);
  const imports = createImports(deps);
  const erase = createErase(deps);

  /** Whether an import still runs for this person (a placeholder counts), after settling a slot that has ended. */
  async function importRunning(who: Who): Promise<boolean> {
    return (await imports.settleRunning(who))?.runningImportId !== undefined;
  }

  async function start(who: Who, { email, password, code }: Reauth, ctx: DeleteContext): Promise<StartResult> {
    const reauth = { sub: who.sub };
    const passwordStep = await signIn.signIn(email, password, { requestId: ctx.requestId, ip: ctx.ip, lang: ctx.lang, reauth });
    if (!passwordStep.ok) return passwordStep;
    if (passwordStep.data.next !== '/sign-in/code') return { ok: false, messageKey: 'auth.signIn.errWrong' };
    const codeStep = await signIn.verifyCode(code, {
      requestId: ctx.requestId,
      ip: ctx.ip,
      lang: ctx.lang,
      preAuthId: passwordStep.data.preAuthId,
      reauth,
    });
    if (!codeStep.ok) return { ok: false, messageKey: codeStep.messageKey };
    if (!('reauthed' in codeStep.data)) return { ok: false, messageKey: DELETE_MESSAGES.unavailable };

    if (await importRunning(who)) return { ok: false, messageKey: DELETE_MESSAGES.running };
    // The mark itself is conditional on no running import, so one that started since the check refuses it (AC-18).
    if (!(await accountStore.markDeleting(who.sub, clock.now())).ok) return { ok: false, messageKey: DELETE_MESSAGES.running };
    logger.event('account_delete', 'started', { requestId: ctx.requestId, sub: who.sub });
    return { ok: true };
  }

  /** Runs fn up to `attempts` times until it answers true; a thrown error counts as a failed attempt. */
  async function attempt(attempts: number, fn: () => Promise<boolean>): Promise<boolean> {
    for (let i = 0; i < attempts; i += 1) {
      try {
        if (await fn()) return true;
      } catch {
        // Tried again below; the step fails after the last attempt.
      }
    }
    return false;
  }

  async function finish(who: Who, ctx: { requestId: string }): Promise<FinishResult> {
    const account = await accountStore.getAccount(who.sub);
    if (account?.status !== 'deleting') return { ok: false, reason: 'not-deleting' };

    let erased: Erased | undefined;
    const steps: Record<DeletionStep, () => Promise<boolean>> = {
      erase: () =>
        attempt(ERASE_ATTEMPTS, async () => {
          const result = await erase.erase(who);
          if (result.ok) erased = result.data;
          return result.ok;
        }),
      'sign-out': () => attempt(STEP_ATTEMPTS, async () => (await sessions.signOutEverywhere(who.sub)).ok),
      'delete-user': () =>
        attempt(STEP_ATTEMPTS, async () => {
          const deleted = await identityProvider.adminDelete(who.sub);
          return deleted.ok || deleted.reason === 'not_found';
        }),
      'delete-row': () =>
        attempt(STEP_ATTEMPTS, async () => {
          await accountStore.deleteAccountRow(who.sub);
          return true;
        }),
    };
    for (const step of DELETION_STEPS) {
      if (!(await steps[step]())) {
        logger.event('account_delete', `failed_${step}`, { requestId: ctx.requestId, sub: who.sub });
        return erased ? { ok: false, reason: 'step', step, erased } : { ok: false, reason: 'step', step };
      }
    }
    logger.event('account_delete', 'done', { requestId: ctx.requestId, sub: who.sub });
    return { ok: true, erased: erased ?? { items: 0, files: 0 } };
  }

  const secret = () => secretStore.get(settings.get().HMAC_SECRET_ARN);

  return {
    start,
    finish,
    /** The goodbye cookie's value: the counts and whether every step finished, signed, for 5 minutes. */
    goodbye: async (goodbye: Goodbye) => goodbyeValue(await secret(), goodbye, clock.now()),
    /** What a goodbye cookie holds, or null when it is missing, changed or expired. */
    readGoodbye: async (value: string | undefined) => (value ? readGoodbyeValue(await secret(), value, clock.now()) : null),
  };
}

export type DeleteAccount = ReturnType<typeof createDeleteAccount>;
