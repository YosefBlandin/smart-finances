import { createHash } from 'node:crypto';
import { createLimits, type LimitsDeps } from '@/application/limits';
import { createSessions, type SessionDeps } from '@/application/session';
import type { BreachChecker } from '@/ports/breach-checker';
import type { Clock } from '@/ports/clock';
import type { Lang } from '@/ports/identity-provider';
import type { Logger } from '@/ports/logger';

// Sign-up (AC-12, AC-14, D-75, D-106, D-117; architecture.md "Auth flows" and the sign-up row of "States and exits").
// The person posts an email, a password and the accepted terms; the reply is the confirm screen whether the email is
// new, unconfirmed or already confirmed, and whether or not a code email went out, so the reply says nothing about the
// account. Every reply, refusals included, takes at least REPLY_MS. In order:
//  1. the accepted terms and the length rule (12 to 128 characters, no composition rules; Contracts "Password and code
//     rules"), then the breach check: breached is refused; 'unavailable' accepts and logs breach_check_unavailable with
//     the request id (D-117, owner decision on the SF-146 deviation);
//  2. a confirmed email: no email and no change (the same reply); a new or unconfirmed one: the code-email cap (3 an
//     hour, 10 a day per email, Contracts "Limits"); over the cap, no email and the same reply;
//  3. an unconfirmed email is deleted and signed up again with the new password (D-106);
//  4. a pre-auth row (step confirm) holds the email, its hash, the accepted versions and the language (D-91, D-87).

export const REPLY_MS = 800;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export type AuthReply<T> = { ok: true; data: T } | { ok: false; messageKey: string; retryAfterSeconds?: number };
export type AuthContext = { requestId: string; preAuthId?: string };
export type AcceptedVersions = { terms: string; privacy: string };

export type AuthDeps = LimitsDeps &
  SessionDeps & {
    logger: Logger;
    /** Waits ms; the padding of the replies. Tests pass one that moves their clock. */
    sleep?: (ms: number) => Promise<void>;
  };
export type SignUpDeps = AuthDeps & { breachChecker: BreachChecker; versions: AcceptedVersions };

export type SignUpInput = { email: string; password: string; accepted: boolean; lang: Lang };

export const MESSAGES = {
  accept: 'auth.signUp.errAccept',
  weak: 'auth.signUp.errWeak',
  refused: 'auth.signUp.errRefused',
  unavailable: 'auth.unavailable',
} as const;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const refuse = (messageKey: string): { ok: false; messageKey: string } => ({ ok: false, messageKey });

/** The login: trimmed and lower-cased (Values: sign-in uses the lower-cased email). */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** The pre-auth row's email_hash: SHA-256 of the login, hex. */
export const emailHash = (email: string) => createHash('sha256').update(normalizeEmail(email)).digest('hex');

/** Characters, not UTF-16 units, so an emoji counts once. */
export const passwordLengthOk = (password: string) => {
  const n = [...password].length;
  return n >= PASSWORD_MIN && n <= PASSWORD_MAX;
};

/** Runs fn and answers no sooner than ms after it started (on the deps' clock); a slower answer is not delayed further. */
export async function padded<T>(deps: { clock: Clock; sleep?: (ms: number) => Promise<void> }, ms: number, fn: () => Promise<T>): Promise<T> {
  const started = deps.clock.now();
  try {
    return await fn();
  } finally {
    const left = ms - (deps.clock.now() - started);
    if (left > 0) await (deps.sleep ?? defaultSleep)(left);
  }
}

export function createSignUp(deps: SignUpDeps) {
  const { identityProvider, breachChecker, logger, versions } = deps;
  const limits = createLimits(deps);
  const sessions = createSessions(deps);

  /** Signs the email up, or seems to; answers the new __Host-pre id (its row is the confirm step) and the login. */
  async function run(input: SignUpInput, ctx: AuthContext): Promise<AuthReply<{ preAuthId: string; email: string }>> {
    const { requestId } = ctx;
    const email = normalizeEmail(input.email);
    if (!input.accepted) return refuse(MESSAGES.accept);
    if (!passwordLengthOk(input.password)) return refuse(MESSAGES.weak);

    const breached = await breachChecker.isBreached(input.password);
    if (breached === 'unavailable') {
      logger.event('breach_check_unavailable', 'unavailable', { requestId });
    } else if (breached) {
      logger.event('breached_password', 'refused', { requestId });
      return refuse(MESSAGES.weak);
    }

    const existing = await identityProvider.adminGet(email);
    if (!existing.ok && existing.reason !== 'not_found') return refuse(MESSAGES.unavailable);
    const unconfirmed = existing.ok && existing.status === 'UNCONFIRMED';

    if (existing.ok && !unconfirmed) {
      // Confirmed (or any state but unconfirmed): nothing changes and no email goes out; the reply is the same.
      logger.event('signup', 'exists', { requestId });
    } else {
      const cap = await limits.hit('code-email', email);
      if (!cap.ok) {
        // Over the code-email cap: no email, the same reply (D-106).
        logger.event('rate_limited', 'code-email', { requestId });
      } else {
        if (existing.ok) {
          const removed = await identityProvider.adminDelete(existing.sub);
          if (!removed.ok && removed.reason !== 'not_found') return refuse(MESSAGES.unavailable);
        }
        const created = await identityProvider.signUp(email, input.password, input.lang);
        if (created.ok) {
          logger.event('signup', unconfirmed ? 'replaced' : 'ok', { requestId });
        } else if (created.reason === 'exists') {
          // Another sign-up for the same email landed in between: the same reply, as for a known email.
          logger.event('signup', 'exists', { requestId });
        } else if (created.reason === 'bad_password') {
          return refuse(MESSAGES.weak);
        } else if (created.reason === 'refused') {
          // The pre-sign-up trigger said no: closed stage, disposable address or another client (AC-19).
          logger.event('signup', 'refused', { requestId });
          return refuse(MESSAGES.refused);
        } else {
          return refuse(MESSAGES.unavailable);
        }
      }
    }

    const { id } = await sessions.startPreAuth(
      {
        step: 'confirm',
        email,
        emailHash: emailHash(email),
        acceptedVersions: { terms: versions.terms, privacy: versions.privacy },
        lang: input.lang,
      },
      ctx.preAuthId,
    );
    return { ok: true, data: { preAuthId: id, email } };
  }

  return (input: SignUpInput, ctx: AuthContext) => padded(deps, REPLY_MS, () => run(input, ctx));
}

export type SignUp = ReturnType<typeof createSignUp>;
