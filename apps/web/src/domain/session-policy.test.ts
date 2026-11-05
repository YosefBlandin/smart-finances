import { describe, expect, it } from 'vitest';
import {
  PRE_AUTH_COOKIE,
  PRE_AUTH_COOKIE_OPTIONS,
  PRE_AUTH_MS,
  REFRESH_WINDOW_MS,
  SESSION_ABSOLUTE_MS,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_IDLE_MS,
  accessTokenExpiry,
  checkPreAuth,
  checkSession,
  isCookieId,
  needsRefresh,
  preAuthExpiry,
  sessionExpiry,
  tokenClaims,
} from './session-policy';

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = 1_790_000_000_000;

// A made-up unsigned token: header.payload.signature, base64url (no padding), as the pool returns them.
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims: object) => `${b64url({ alg: 'none' })}.${b64url(claims)}.c2ln`;

describe('T-WAUTH-3 session policy (D-72)', () => {
  it('T-WAUTH-3 idle 30 minutes, absolute 12 hours, refresh under 5 minutes, pre-auth 15 minutes', () => {
    expect(SESSION_IDLE_MS).toBe(30 * MIN);
    expect(SESSION_ABSOLUTE_MS).toBe(12 * HOUR);
    expect(REFRESH_WINDOW_MS).toBe(5 * MIN);
    expect(PRE_AUTH_MS).toBe(15 * MIN);
    expect(sessionExpiry(T0)).toBe(T0 + 12 * HOUR);
    expect(preAuthExpiry(T0)).toBe(T0 + 15 * MIN);
  });

  it('T-WAUTH-3 a session is active until 30 idle minutes, then idle (edge included)', () => {
    const row = { createdAt: T0, lastSeenAt: T0 + HOUR, expiresAt: sessionExpiry(T0) };
    expect(checkSession(row, T0 + HOUR)).toBe('active');
    expect(checkSession(row, T0 + HOUR + 30 * MIN - 1)).toBe('active');
    expect(checkSession(row, T0 + HOUR + 30 * MIN)).toBe('idle');
  });

  it('T-WAUTH-3 a session ends 12 hours after it was created, however recently it was used', () => {
    const row = { createdAt: T0, lastSeenAt: T0 + 12 * HOUR - MIN, expiresAt: sessionExpiry(T0) };
    expect(checkSession(row, T0 + 12 * HOUR - 1)).toBe('active');
    expect(checkSession(row, T0 + 12 * HOUR)).toBe('expired');
    // The absolute limit holds even when a row's expires_at says later (a row the policy did not write).
    expect(checkSession({ ...row, expiresAt: T0 + 48 * HOUR }, T0 + 12 * HOUR)).toBe('expired');
    // And an earlier expires_at ends it earlier.
    expect(checkSession({ ...row, lastSeenAt: T0, expiresAt: T0 + 10 * MIN }, T0 + 10 * MIN)).toBe('expired');
  });

  it('T-WAUTH-3 refresh when the access token has under 5 minutes left, or its expiry is unknown', () => {
    expect(needsRefresh(T0 + 5 * MIN, T0)).toBe(false);
    expect(needsRefresh(T0 + 5 * MIN - 1, T0)).toBe(true);
    expect(needsRefresh(T0 - 1, T0)).toBe(true);
    expect(needsRefresh(undefined, T0)).toBe(true);
  });

  it('T-WAUTH-3 the access token expiry and the id token claims are read from the token payload', () => {
    expect(accessTokenExpiry(jwt({ exp: 1_790_003_600, sub: 'x' }))).toBe(1_790_003_600_000);
    expect(accessTokenExpiry('not-a-token')).toBeUndefined();
    expect(accessTokenExpiry(`${b64url({})}.%%%.sig`)).toBeUndefined();
    expect(accessTokenExpiry(jwt({ exp: 'soon' }))).toBeUndefined();
    expect(tokenClaims(jwt({ sub: '00000000-0000-4000-8000-000000000001', email: 'person@example.test' }))).toEqual({
      sub: '00000000-0000-4000-8000-000000000001',
      email: 'person@example.test',
    });
    expect(tokenClaims(jwt([1, 2] as unknown as object))).toBeUndefined();
  });

  it('T-WAUTH-3 cookie flags per contract: __Host-sid Secure, HttpOnly, SameSite=Lax, Path=/, no Max-Age', () => {
    expect(SESSION_COOKIE).toBe('__Host-sid');
    expect(SESSION_COOKIE_OPTIONS).toEqual({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    expect(SESSION_COOKIE_OPTIONS).not.toHaveProperty('maxAge');
    expect(SESSION_COOKIE_OPTIONS).not.toHaveProperty('domain');
  });

  it('T-WAUTH-3 cookie ids are 32 random bytes in base64url (43 characters); anything else is no cookie', () => {
    expect(isCookieId('A'.repeat(43))).toBe(true);
    expect(isCookieId('abc-_'.repeat(8) + 'xyz')).toBe(true);
    expect(isCookieId('A'.repeat(42))).toBe(false);
    expect(isCookieId('A'.repeat(44))).toBe(false);
    expect(isCookieId('A'.repeat(42) + '=')).toBe(false);
    expect(isCookieId('A'.repeat(42) + '+')).toBe(false);
    expect(isCookieId(undefined)).toBe(false);
    expect(isCookieId('')).toBe(false);
  });
});

describe('T-WAUTH-4 pre-auth policy (D-91)', () => {
  it('T-WAUTH-4 __Host-pre is Secure, HttpOnly, SameSite=Strict, Path=/, Max-Age 900', () => {
    expect(PRE_AUTH_COOKIE).toBe('__Host-pre');
    expect(PRE_AUTH_COOKIE_OPTIONS).toEqual({ httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 900 });
  });

  it('T-WAUTH-4 a pre-auth row lives 15 minutes (edge included)', () => {
    const row = { expiresAt: preAuthExpiry(T0) };
    expect(checkPreAuth(row, T0)).toBe(true);
    expect(checkPreAuth(row, T0 + 15 * MIN - 1)).toBe(true);
    expect(checkPreAuth(row, T0 + 15 * MIN)).toBe(false);
    expect(checkPreAuth({ expiresAt: T0 - 1 }, T0)).toBe(false);
  });
});
