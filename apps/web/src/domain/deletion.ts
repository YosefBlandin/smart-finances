import { createHmac, timingSafeEqual } from 'node:crypto';

// Deleting an account (AC-18, D-104; architecture.md "States and exits", row "deleting account"). After a full
// re-sign-in and with no running import, the account is marked deleting; then these steps run in this order, each one
// safe to run again, so a deletion that stops at any step is finished by running them all again:
//  1. erase: DELETE /data until it answers 202 (a repeat resumes an unfinished erase);
//  2. sign-out: the pool's global sign-out and every session row of the person;
//  3. delete-user: the pool user (already gone counts as done);
//  4. delete-row: the account row, last, so a deletion that stops before it is still marked deleting.
// From sign-out on the person has no session left, so only the hourly job can finish a deletion that stops there.

export const DELETION_STEPS = ['erase', 'sign-out', 'delete-user', 'delete-row'] as const;
export type DeletionStep = (typeof DELETION_STEPS)[number];

/** Whether the person's sessions are already gone when this step fails (sign-out removes the rows even when it fails). */
export const sessionsGoneAt = (step: DeletionStep) => DELETION_STEPS.indexOf(step) >= DELETION_STEPS.indexOf('sign-out');

// --- The goodbye cookie ---------------------------------------------------------------------------------------------
// /goodbye is public: after the deletion the person has no session, so the result travels in a cookie the server signed
// with the stage's HMAC secret (D-115): Secure, HttpOnly, SameSite=Lax, Path=/, 5 minutes. It holds only the counts
// and whether every step finished, never a sub or an email; the signed payload carries its own expiry too.

export const GOODBYE = { cookie: '__Host-goodbye', maxAgeSeconds: 300 } as const;

export type Erased = { items: number; files: number };
/** done: every step finished; partial: the account is closed, the hourly job finishes the rest. */
export type Goodbye = { erased?: Erased; closed: 'done' | 'partial' };

type Payload = { c: 'done' | 'partial'; i?: number; f?: number; exp: number };

const sign = (secret: string, payload: string) => createHmac('sha256', secret).update(`goodbye.${payload}`).digest('base64url');
const count = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

/** The cookie value: base64url(JSON) "." HMAC, valid for GOODBYE.maxAgeSeconds from now. */
export function goodbyeValue(secret: string, goodbye: Goodbye, now: number): string {
  const p: Payload = { c: goodbye.closed, exp: now + GOODBYE.maxAgeSeconds * 1000 };
  if (goodbye.erased) {
    p.i = goodbye.erased.items;
    p.f = goodbye.erased.files;
  }
  const payload = Buffer.from(JSON.stringify(p)).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

/** The goodbye a cookie value holds, or null when it is missing, changed, signed with another secret or expired. */
export function readGoodbyeValue(secret: string, value: string | undefined, now: number): Goodbye | null {
  if (!value || value.length > 512) return null;
  const [payload, sig, extra] = value.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  const want = Buffer.from(sign(secret, payload));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  let p: Partial<Payload>;
  try {
    p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<Payload>;
  } catch {
    return null;
  }
  if (typeof p.exp !== 'number' || p.exp < now || (p.c !== 'done' && p.c !== 'partial')) return null;
  return count(p.i) && count(p.f) ? { erased: { items: p.i, files: p.f }, closed: p.c } : { closed: p.c };
}
