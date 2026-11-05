import { cookies } from 'next/headers';
import {
  PRE_AUTH_COOKIE,
  PRE_AUTH_COOKIE_OPTIONS,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  isCookieId,
  type CookieOptions,
} from '@/domain/session-policy';

// Reads and writes __Host-sid and __Host-pre (architecture.md Contracts "Cookies", D-72, D-91) for server components,
// server actions and route handlers. A value that is not a 43-character base64url id reads as no cookie. Setting works
// only in a server action or route handler (Next.js rule); clearing sets an empty value with Max-Age 0.

async function read(name: string): Promise<string | undefined> {
  const value = (await cookies()).get(name)?.value;
  return isCookieId(value) ? value : undefined;
}

async function write(name: string, value: string, options: CookieOptions) {
  (await cookies()).set(name, value, { ...options });
}

export const readSessionCookie = () => read(SESSION_COOKIE);
export const setSessionCookie = (id: string) => write(SESSION_COOKIE, id, SESSION_COOKIE_OPTIONS);
export const clearSessionCookie = () => write(SESSION_COOKIE, '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });

export const readPreAuthCookie = () => read(PRE_AUTH_COOKIE);
export const setPreAuthCookie = (id: string) => write(PRE_AUTH_COOKIE, id, PRE_AUTH_COOKIE_OPTIONS);
export const clearPreAuthCookie = () => write(PRE_AUTH_COOKIE, '', { ...PRE_AUTH_COOKIE_OPTIONS, maxAge: 0 });
