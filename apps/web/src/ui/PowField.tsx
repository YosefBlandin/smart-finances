// The proof-of-work answer for sign-up and the auth forms (D-120). Put inside a form, it fetches a challenge from
// /api/auth/pow, finds n with Web Crypto (SHA-256(salt + n) = challenge, trying 0, 1, 2, … up to max) and adds powSalt,
// powN and powSig as hidden fields; guarded() checks them on the server. An answer is good for one post and 10 minutes,
// so a new one is solved after each submit and a minute before the old one would expire. The digests are awaited one by
// one on the main thread: no worker, inline script or style is added, so the content policy needs nothing new (D-57).
// If the challenge cannot be fetched the fields stay empty and the post is refused with "reload and try again".
'use client';

import { useEffect, useRef, useState } from 'react';

export const POW_ENDPOINT = '/api/auth/pow';
const REFRESH_MS = 9 * 60_000;
const MIN_REFRESH_MS = 30_000;

// The route's reply, checked like any other boundary (D-124). Checked by hand rather than with zod, which would add
// about 26 KB of compressed JavaScript to every page that holds a form (the Lighthouse budget, T-WEB-17).
type Challenge = { salt: string; challenge: string; max: number; expires: number; sig: string };
const isHex64 = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

export function parseChallenge(value: unknown): Challenge {
  const c = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const { salt, challenge, max, expires, sig } = c;
  if (
    typeof salt !== 'string' ||
    salt.length < 1 ||
    salt.length > 64 ||
    !isHex64(challenge) ||
    typeof max !== 'number' ||
    !Number.isInteger(max) ||
    max < 0 ||
    max > 10_000_000 ||
    typeof expires !== 'number' ||
    !Number.isFinite(expires) ||
    !isHex64(sig)
  ) {
    throw new Error('invalid proof-of-work challenge');
  }
  return { salt, challenge, max, expires, sig };
}

export type PowPuzzle = { salt: string; challenge: string; max: number };
type Answer = { salt: string; n: string; sig: string };

const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The n in [0, max] with SHA-256(salt + n) = challenge, or undefined when there is none or the search is cancelled. */
export async function solvePow(
  { salt, challenge, max }: PowPuzzle,
  subtle: SubtleCrypto = globalThis.crypto.subtle,
  cancelled: () => boolean = () => false,
): Promise<number | undefined> {
  const target = hexBytes(challenge);
  const encoder = new TextEncoder();
  for (let n = 0; n <= max; n++) {
    if (cancelled()) return undefined;
    const digest = new Uint8Array(await subtle.digest('SHA-256', encoder.encode(salt + String(n))));
    if (same(digest, target)) return n;
  }
  return undefined;
}

export function PowField() {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [round, setRound] = useState(0);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    (async () => {
      try {
        const res = await fetch(POW_ENDPOINT, { cache: 'no-store', credentials: 'same-origin' });
        if (!res.ok || cancelled) return;
        const c = parseChallenge(await res.json());
        const n = await solvePow(c, globalThis.crypto.subtle, () => cancelled);
        if (cancelled || n === undefined) return;
        setAnswer({ salt: c.salt, n: String(n), sig: c.sig });
        // Timed from the fetch, not from expires, so a skewed device clock cannot make it refetch in a loop.
        timer = setTimeout(() => setRound((r) => r + 1), Math.max(MIN_REFRESH_MS, REFRESH_MS - (Date.now() - started)));
      } catch {
        // Left empty: the server refuses the post with a plain message.
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [round]);

  // The browser reads the fields when the form submits; after that the answer is spent, so start a new one.
  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSubmit = () => {
      timer = setTimeout(() => {
        setAnswer(null);
        setRound((r) => r + 1);
      }, 0);
    };
    form.addEventListener('submit', onSubmit);
    return () => {
      form.removeEventListener('submit', onSubmit);
      clearTimeout(timer);
    };
  }, []);

  return (
    <>
      <input ref={ref} type="hidden" name="powSalt" value={answer?.salt ?? ''} data-state={answer ? 'ready' : 'solving'} />
      <input type="hidden" name="powN" value={answer?.n ?? ''} />
      <input type="hidden" name="powSig" value={answer?.sig ?? ''} />
    </>
  );
}
