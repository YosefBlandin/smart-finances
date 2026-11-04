import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Clock } from '@/ports/clock';
import type { PowStore } from '@/ports/pow-store';
import type { SecretStore } from '@/ports/secret-store';
import type { Settings } from '@/ports/settings';

// The self-hosted proof of work that guards sign-up and the auth posts (D-120; architecture.md Contracts "Limits",
// "Sessions table" pow item). issue() picks a random n in [0, max] and hands out SHA-256(salt + n) with an HMAC
// signature; the browser finds n by trying 0, 1, 2, … (ui/PowField.tsx) and posts powSalt, powN and powSig. The salt
// carries its own expiry (<16 random bytes, base64url>.<expires, epoch ms>), so the signature binds the expiry too and
// verify() needs no row until the answer checks out; then one claim of POW#<sha256 of salt> makes it single use.
// verify() never throws for bad input; a claim-store or secret failure is thrown (guarded() turns it into a message).

export const POW_MAX = 100_000;
export const POW_TTL_MS = 10 * 60_000;

export type PowChallenge = { salt: string; challenge: string; max: number; expires: number; sig: string };
/** What the form posts (powSalt, powN, powSig), unchecked. */
export type PowAnswer = { salt: unknown; n: unknown; sig: unknown };
export type PowRefusal = 'missing' | 'malformed' | 'wrong' | 'expired' | 'reused';
export type PowVerdict = { ok: true } | { ok: false; reason: PowRefusal };

export type PowDeps = { powStore: PowStore; clock: Clock; secretStore: SecretStore; settings: Settings; max?: number };

const SALT = /^[A-Za-z0-9_-]{22}\.(\d{13})$/;
const DIGITS = /^(0|[1-9]\d{0,8})$/;
const HEX64 = /^[0-9a-f]{64}$/;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
// Domain-separated from the counter keys, which use the same stage secret (D-115).
const sign = (secret: string, challenge: string) => createHmac('sha256', secret).update(`pow:${challenge}`).digest('hex');
const blank = (v: unknown) => v === undefined || v === null || v === '';

export function createPow({ powStore, clock, secretStore, settings, max = POW_MAX }: PowDeps) {
  const secret = () => secretStore.get(settings.get().HMAC_SECRET_ARN);

  async function issue(): Promise<PowChallenge> {
    const key = await secret();
    const expires = clock.now() + POW_TTL_MS;
    const salt = `${randomBytes(16).toString('base64url')}.${expires}`;
    const challenge = sha256(salt + String(randomInt(0, max + 1)));
    return { salt, challenge, max, expires, sig: sign(key, challenge) };
  }

  async function verify({ salt, n, sig }: PowAnswer): Promise<PowVerdict> {
    if (blank(salt) || blank(n) || blank(sig)) return { ok: false, reason: 'missing' };
    if (typeof salt !== 'string' || typeof n !== 'string' || typeof sig !== 'string') return { ok: false, reason: 'malformed' };
    const m = SALT.exec(salt);
    if (!m || !DIGITS.test(n) || Number(n) > max || !HEX64.test(sig)) return { ok: false, reason: 'malformed' };

    const expected = Buffer.from(sign(await secret(), sha256(salt + n)), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(sig, 'hex'))) return { ok: false, reason: 'wrong' };
    if (Number(m[1]) <= clock.now()) return { ok: false, reason: 'expired' };
    // The claim outlives the answer: it is made before expires, and lasts the answer's whole life from now.
    if (!(await powStore.claim(sha256(salt), POW_TTL_MS))) return { ok: false, reason: 'reused' };
    return { ok: true };
  }

  return { issue, verify };
}

export type Pow = ReturnType<typeof createPow>;
