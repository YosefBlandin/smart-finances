import { createSessions, sessionIdHash, type SessionDeps } from '@/application/session';
import { isCookieId } from '@/domain/session-policy';
import type { Logger } from '@/ports/logger';

// Sign out (AC-16, D-72, D-115): a post from the signed-in person ends this browser's session. The row behind
// __Host-sid goes and its refresh token is revoked at the pool, so neither the cookie nor a copy of the tokens works
// again; other devices stay signed in (a reset signs out everywhere instead, application/auth/reset.ts). The caller
// clears __Host-sid and opens the sign-in screen. With no live session there is nothing to end and the answer is the
// same.

export type SignOutDeps = SessionDeps & { logger: Logger };

export function createSignOut(deps: SignOutDeps) {
  const sessions = createSessions(deps);
  return async function signOut(sessionId: string | undefined, ctx: { requestId: string }): Promise<{ ok: true; data: { next: '/sign-in' } }> {
    // The row as stored, not through the idle and 12-hour checks: an idle row's refresh token is revoked too.
    const row = isCookieId(sessionId) ? await deps.sessionStore.get(sessionIdHash(sessionId)) : undefined;
    await sessions.endSession(sessionId);
    if (row) deps.logger.event('signout', 'ok', { requestId: ctx.requestId, sub: row.sub });
    return { ok: true, data: { next: '/sign-in' } };
  };
}

export type SignOut = ReturnType<typeof createSignOut>;
