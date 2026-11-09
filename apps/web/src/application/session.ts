import { createHash, randomBytes } from 'node:crypto';
import {
  accessTokenExpiry,
  checkPreAuth,
  checkSession,
  isCookieId,
  needsRefresh,
  preAuthExpiry,
  sessionExpiry,
  SESSION_TOUCH_MS,
  tokenClaims,
} from '@/domain/session-policy';
import type { Clock } from '@/ports/clock';
import type { IdentityProvider, Tokens } from '@/ports/identity-provider';
import type { PreAuthRow, PreAuthStore } from '@/ports/pre-auth-store';
import type { SessionRow, SessionStore } from '@/ports/session-store';

// Server-held sessions and the pre-auth state (D-72, D-91; architecture.md "Sessions and accounts"). The browser holds
// only the opaque ids of __Host-sid and __Host-pre (app/cookies.ts); rows are keyed by the SHA-256 of those ids, so a
// table read cannot be replayed as a cookie. Every read applies the policy itself; the TTL only cleans up. These use
// cases take the cookie value in and hand a new id back: app/ reads and writes the cookies (D-138).

export type SessionDeps = { sessionStore: SessionStore; preAuthStore: PreAuthStore; identityProvider: IdentityProvider; clock: Clock };

/** What a signed-in request may use. The refresh token stays in the row. */
export type Session = {
  idHash: string;
  sub: string;
  /** From the id token's email claim; empty when the token carries none. */
  email: string;
  accessToken: string;
  idToken: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
};

export type SessionRead = { status: 'active'; session: Session } | { status: 'none' | 'idle' | 'expired' };

export type PreAuthStart = Omit<PreAuthRow, 'idHash' | 'expiresAt' | 'attempts'> & { attempts?: number };
export type PreAuthPatch = Partial<Omit<PreAuthRow, 'idHash' | 'expiresAt'>>;

/** 32 random bytes, base64url: a __Host-sid or __Host-pre value. */
export const newCookieId = () => randomBytes(32).toString('base64url');

/** The row key of a cookie id: SHA-256, hex. */
export const sessionIdHash = (id: string) => createHash('sha256').update(id).digest('hex');

function toSession(row: SessionRow): Session {
  const email = tokenClaims(row.idToken)?.email;
  return {
    idHash: row.idHash,
    sub: row.sub,
    email: typeof email === 'string' ? email : '',
    accessToken: row.accessToken,
    idToken: row.idToken,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
  };
}

export function createSessions({ sessionStore, preAuthStore, identityProvider, clock }: SessionDeps) {
  /** The session behind a __Host-sid value; an idle or expired row is deleted and reported as such. */
  async function readSession(id: string | undefined): Promise<SessionRead> {
    if (!isCookieId(id)) return { status: 'none' };
    const idHash = sessionIdHash(id);
    const row = await sessionStore.get(idHash);
    if (!row) return { status: 'none' };
    const now = clock.now();
    const state = checkSession(row, now);
    if (state !== 'active') {
      await sessionStore.delete(idHash);
      return { status: state };
    }
    // Within a minute of the last write the row just read is enough: the idle limit moves by at most that minute (D-192).
    if (now - row.lastSeenAt < SESSION_TOUCH_MS) return { status: 'active', session: toSession(row) };
    if (!(await sessionStore.touch(idHash, now))) return { status: 'none' };
    return { status: 'active', session: toSession({ ...row, lastSeenAt: now }) };
  }

  async function getSession(id: string | undefined): Promise<Session | null> {
    const read = await readSession(id);
    return read.status === 'active' ? read.session : null;
  }

  /**
   * A new session id at every sign-in (D-72): the previous session row and the pre-auth row, when given, are removed.
   * Returns the id for __Host-sid.
   */
  async function createSession(input: { sub: string; tokens: Tokens; preAuthId?: string; previousSessionId?: string }) {
    const now = clock.now();
    const id = newCookieId();
    const row: SessionRow = {
      idHash: sessionIdHash(id),
      sub: input.sub,
      accessToken: input.tokens.access,
      idToken: input.tokens.id,
      refreshToken: input.tokens.refresh,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: sessionExpiry(now),
    };
    if (isCookieId(input.previousSessionId)) await sessionStore.delete(sessionIdHash(input.previousSessionId));
    if (isCookieId(input.preAuthId)) await preAuthStore.delete(sessionIdHash(input.preAuthId));
    await sessionStore.create(row);
    return { id, session: toSession(row) };
  }

  /**
   * Refreshes the tokens on the server when the access token has under 5 minutes left (the sub is the username in the
   * secret hash). A refused refresh ends the session (null, row deleted); a failed one keeps a still-valid token.
   */
  async function refreshIfNeeded(session: Session): Promise<Session | null> {
    const now = clock.now();
    const expiry = accessTokenExpiry(session.accessToken);
    if (!needsRefresh(expiry, now)) return session;
    const row = await sessionStore.get(session.idHash);
    if (!row || checkSession(row, now) !== 'active') return null;
    const result = await identityProvider.refresh(row.sub, row.refreshToken);
    if (!result.ok) {
      if (result.reason === 'revoked') {
        await sessionStore.delete(row.idHash);
        return null;
      }
      return expiry !== undefined && expiry > now ? session : null;
    }
    // Written back only while the row still exists, so a sign-out during the refresh stays a sign-out (the window
    // between this read and the write is not closed: the port has no conditional replace).
    if (!(await sessionStore.get(row.idHash))) return null;
    const next: SessionRow = { ...row, accessToken: result.tokens.access, idToken: result.tokens.id, refreshToken: result.tokens.refresh };
    await sessionStore.create(next);
    return toSession(next);
  }

  /** Sign out of this session: the row goes and its refresh token is revoked. Nothing to do without a row. */
  async function endSession(id: string | undefined): Promise<void> {
    if (!isCookieId(id)) return;
    const idHash = sessionIdHash(id);
    const row = await sessionStore.get(idHash);
    await sessionStore.delete(idHash);
    if (row) await identityProvider.revoke(row.refreshToken);
  }

  /** After a reset or for a deletion (D-92): global sign-out on the pool, then every session row of the person. */
  async function signOutEverywhere(sub: string): Promise<{ ok: boolean; removed: number }> {
    const result = await identityProvider.adminGlobalSignOut(sub);
    const removed = await sessionStore.deleteBySub(sub);
    return { ok: result.ok, removed };
  }

  /** A new pre-auth row for 15 minutes with a fresh id for __Host-pre; the previous one, when given, is removed. */
  async function startPreAuth(fields: PreAuthStart, previousPreAuthId?: string) {
    if (isCookieId(previousPreAuthId)) await preAuthStore.delete(sessionIdHash(previousPreAuthId));
    const id = newCookieId();
    const row: PreAuthRow = { ...fields, attempts: fields.attempts ?? 0, idHash: sessionIdHash(id), expiresAt: preAuthExpiry(clock.now()) };
    await preAuthStore.create(row);
    return { id, row };
  }

  async function readPreAuth(id: string | undefined): Promise<PreAuthRow | null> {
    if (!isCookieId(id)) return null;
    const idHash = sessionIdHash(id);
    const row = await preAuthStore.get(idHash);
    if (!row) return null;
    if (!checkPreAuth(row, clock.now())) {
      await preAuthStore.delete(idHash);
      return null;
    }
    return row;
  }

  /** The 15 minutes run from the start: a patch never moves expiresAt. False when the row is gone or expired. */
  async function updatePreAuth(id: string | undefined, patch: PreAuthPatch): Promise<boolean> {
    if (!isCookieId(id)) return false;
    const rest: Record<string, unknown> = { ...patch };
    delete rest.expiresAt;
    delete rest.idHash;
    if (!(await readPreAuth(id))) return false;
    return preAuthStore.update(sessionIdHash(id), rest as PreAuthPatch);
  }

  async function endPreAuth(id: string | undefined): Promise<void> {
    if (isCookieId(id)) await preAuthStore.delete(sessionIdHash(id));
  }

  return {
    readSession,
    getSession,
    createSession,
    refreshIfNeeded,
    endSession,
    signOutEverywhere,
    startPreAuth,
    readPreAuth,
    updatePreAuth,
    endPreAuth,
  };
}

export type Sessions = ReturnType<typeof createSessions>;
