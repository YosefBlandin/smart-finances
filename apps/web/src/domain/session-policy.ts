// Session and pre-auth policy (D-72, D-91; architecture.md Contracts "Cookies" and "Sessions table"). Pure: times are
// epoch milliseconds passed in. Every read checks these limits itself; the table's TTL only cleans up.

const MIN = 60_000;

export const SESSION_IDLE_MS = 30 * MIN;
export const SESSION_ABSOLUTE_MS = 12 * 60 * MIN;
/** last_seen_at is written at most this often, so a page's several reads cost one write, not one each (D-192). */
export const SESSION_TOUCH_MS = MIN;
/** Refresh on the server when the access token has less than this left. */
export const REFRESH_WINDOW_MS = 5 * MIN;
export const PRE_AUTH_MS = 15 * MIN;

export const SESSION_COOKIE = '__Host-sid';
export const PRE_AUTH_COOKIE = '__Host-pre';

export type CookieOptions = { httpOnly: true; secure: true; sameSite: 'lax' | 'strict'; path: '/'; maxAge?: number };

/** __Host-sid: no Max-Age, so the session ends with the browser, not the tab (D-72). __Host- forbids a Domain. */
export const SESSION_COOKIE_OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' };
/** __Host-pre: SameSite=Strict and the pre-auth row's 15 minutes (D-91). */
export const PRE_AUTH_COOKIE_OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: PRE_AUTH_MS / 1000 };

export const sessionExpiry = (createdAt: number) => createdAt + SESSION_ABSOLUTE_MS;
export const preAuthExpiry = (now: number) => now + PRE_AUTH_MS;

export type SessionCheck = 'active' | 'idle' | 'expired';

/** expired: 12 hours since sign-in or the row's own expiry, whichever is first; idle: 30 minutes since last seen. */
export function checkSession(row: { createdAt: number; lastSeenAt: number; expiresAt: number }, now: number): SessionCheck {
  if (now >= Math.min(row.expiresAt, sessionExpiry(row.createdAt))) return 'expired';
  if (now >= row.lastSeenAt + SESSION_IDLE_MS) return 'idle';
  return 'active';
}

export const checkPreAuth = (row: { expiresAt: number }, now: number) => now < row.expiresAt;

/** An unknown expiry is treated as due. */
export const needsRefresh = (accessExpiresAt: number | undefined, now: number) =>
  accessExpiresAt === undefined || accessExpiresAt - now < REFRESH_WINDOW_MS;

/** The cookie ids are 32 random bytes in base64url without padding: exactly 43 characters. */
export const isCookieId = (value: string | undefined): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

/**
 * The payload of a token the pool returned to this server (never one a browser sent), read without checking the
 * signature: only for its exp and the person's claims. Anything malformed is undefined.
 */
export function tokenClaims(token: string): Record<string, unknown> | undefined {
  const part = token.split('.')[1];
  if (!part || !/^[A-Za-z0-9_-]+$/.test(part)) return undefined;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? (claims as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** The access token's exp claim in epoch milliseconds, or undefined. */
export function accessTokenExpiry(token: string): number | undefined {
  const exp = tokenClaims(token)?.exp;
  return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : undefined;
}
