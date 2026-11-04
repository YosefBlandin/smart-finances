import { createSessions, type Session, type SessionDeps } from '@/application/session';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/legal/versions';
import type { Account, AccountStore, Consent } from '@/ports/account-store';
import type { Lang } from '@/ports/identity-provider';
import type { Logger } from '@/ports/logger';

// The server-only guard of the money screens (D-108, D-87, D-145, D-104; architecture.md "Sessions and accounts").
// requireMoneyAccess needs a live session (idle 30 minutes and 12 hours checked on the read; the tokens refreshed when
// due), a consent at the current terms and privacy versions, and an account that is active, not marked deleting (unless
// the caller is the deletion's own finish step, allowDeleting). The money layout and guarded()'s kind "money" call it;
// app/guarded.ts also exports requireMoneyAccess({ allowDeleting? }) over the __Host-sid cookie (application/ never
// reads cookies, D-138). The consent screen's use cases live here too: what it shows, accept (the current versions
// only) and decline (signs out). The first consent is written at the first completed sign-in (application/auth/signIn.ts,
// recordFirstConsent below).

export type Versions = { terms: string; privacy: string };

/** The versions every money screen needs accepted (legal/versions.ts). */
export const CURRENT_VERSIONS: Versions = { terms: TERMS_VERSION, privacy: PRIVACY_VERSION };

export type GuardDeps = SessionDeps & { accountStore: AccountStore; logger: Logger };

export type SignedOutWhy = 'none' | 'idle' | 'expired';
export type MoneyAccess =
  | { ok: true; session: Session; account: Account }
  | { ok: false; reason: 'signed-out'; why: SignedOutWhy }
  | { ok: false; reason: 'consent' | 'deleting' };

export type ConsentView =
  | { status: 'signed-out'; why: SignedOutWhy }
  | { status: 'deleting' }
  | { status: 'current' }
  | { status: 'needed'; changed: boolean; versions: Versions };

export const isCurrent = (consent: Consent | undefined, versions: Versions = CURRENT_VERSIONS) =>
  consent?.termsVersion === versions.terms && consent.privacyVersion === versions.privacy;

/**
 * At the first completed sign-in: the versions the person accepted at sign-up (from the pre-auth row) become the
 * account's consent, with the language and the time (D-87). An account that already has a consent keeps it.
 */
export async function recordFirstConsent(
  deps: { accountStore: AccountStore; clock: { now(): number } },
  sub: string,
  accepted: { versions?: Versions; lang: Lang },
): Promise<void> {
  if (!accepted.versions) return;
  const account = await deps.accountStore.getAccount(sub);
  if (account?.consent) return;
  await deps.accountStore.putConsent(sub, {
    termsVersion: accepted.versions.terms,
    privacyVersion: accepted.versions.privacy,
    lang: accepted.lang,
    acceptedAt: deps.clock.now(),
  });
}

export function createGuard(deps: GuardDeps, versions: Versions = CURRENT_VERSIONS) {
  const sessions = createSessions(deps);
  const { accountStore, logger, clock } = deps;

  /** The live session behind a __Host-sid value, refreshed when due; why it is gone otherwise. */
  async function liveSession(sessionId: string | undefined): Promise<{ session: Session } | { why: SignedOutWhy }> {
    const read = await sessions.readSession(sessionId);
    if (read.status !== 'active') return { why: read.status };
    const session = await sessions.refreshIfNeeded(read.session);
    return session ? { session } : { why: 'expired' };
  }

  async function requireMoneyAccess(sessionId: string | undefined, opts: { allowDeleting?: boolean } = {}): Promise<MoneyAccess> {
    const live = await liveSession(sessionId);
    if ('why' in live) return { ok: false, reason: 'signed-out', why: live.why };
    const account = await accountStore.getAccount(live.session.sub);
    if (account?.status === 'deleting' && !opts.allowDeleting) return { ok: false, reason: 'deleting' };
    if (!account || !isCurrent(account.consent, versions)) return { ok: false, reason: 'consent' };
    return { ok: true, session: live.session, account };
  }

  async function consentView(sessionId: string | undefined): Promise<ConsentView> {
    const live = await liveSession(sessionId);
    if ('why' in live) return { status: 'signed-out', why: live.why };
    const account = await accountStore.getAccount(live.session.sub);
    if (account?.status === 'deleting') return { status: 'deleting' };
    if (isCurrent(account?.consent, versions)) return { status: 'current' };
    return { status: 'needed', changed: account?.consent !== undefined, versions };
  }

  /** Records the versions the screen showed, only while they are the current ones (D-145). */
  async function acceptConsent(
    sessionId: string | undefined,
    shown: Versions,
    lang: Lang,
  ): Promise<{ ok: true } | { ok: false; reason: 'signed-out' | 'deleting' | 'changed' }> {
    const live = await liveSession(sessionId);
    if ('why' in live) return { ok: false, reason: 'signed-out' };
    if (shown.terms !== versions.terms || shown.privacy !== versions.privacy) return { ok: false, reason: 'changed' };
    const account = await accountStore.getAccount(live.session.sub);
    if (account?.status === 'deleting') return { ok: false, reason: 'deleting' };
    await accountStore.putConsent(live.session.sub, {
      termsVersion: versions.terms,
      privacyVersion: versions.privacy,
      lang,
      acceptedAt: clock.now(),
    });
    return { ok: true };
  }

  /** Refusing signs out: the session row goes and its refresh token is revoked. Nothing is written to the account. */
  async function declineConsent(sessionId: string | undefined, ctx: { requestId: string }): Promise<void> {
    const read = await sessions.readSession(sessionId);
    await sessions.endSession(sessionId);
    if (read.status === 'active') logger.event('signout', 'consent_declined', { requestId: ctx.requestId, sub: read.session.sub });
  }

  return { requireMoneyAccess, consentView, acceptConsent, declineConsent };
}

export type Guard = ReturnType<typeof createGuard>;
