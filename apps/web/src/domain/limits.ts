import { createHmac } from 'node:crypto';

// Limit windows (D-120, D-115; architecture.md Contracts "Limits" and "Sessions table" counter item). Pure: times are
// epoch milliseconds passed in, and the HMAC key is passed in. A count lives in the fixed window that starts at
// floor(now / window) * window, so a new window starts from zero at its edge. Counter keys hold only an HMAC of what
// they count (the address prefix, the email with the address prefix, the email, or the sub), never the raw value.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export type Stage = 'test' | 'qa' | 'staging' | 'prod';

/**
 * ip-auth: auth posts per address prefix; auth-fail: sign-in or reset failures per email and address prefix;
 * code-email: code emails per email (two windows); person: data requests per person (the sub).
 */
export type LimitScope = 'ip-auth' | 'auth-fail' | 'code-email' | 'person';

/** One window of a scope: id names it in the counter key. */
export type LimitWindow = { id: string; ms: number; limit: number };

/** What each scope counts. ip is the client address from clientIp(), or undefined when there is none. */
export type LimitInput = {
  'ip-auth': string | undefined;
  'auth-fail': { email: string; ip: string | undefined };
  'code-email': string;
  person: string;
};

/** A counter item lives until its window ends plus this, so a late read still sees it (Contracts "Sessions table"). */
export const COUNTER_GRACE_MS = MIN;

/** The data requests a person may make per minute: 120, or 5 under STAGE=test so browser tests can reach it. */
const personLimit = (stage: Stage) => (stage === 'test' ? 5 : 120);

export function limitsFor(stage: Stage): Record<LimitScope, LimitWindow[]> {
  return {
    'ip-auth': [{ id: 'ip-auth', ms: 5 * MIN, limit: 20 }],
    'auth-fail': [{ id: 'auth-fail', ms: 15 * MIN, limit: 5 }],
    'code-email': [
      { id: 'code-email-1h', ms: HOUR, limit: 3 },
      { id: 'code-email-1d', ms: DAY, limit: 10 },
    ],
    person: [{ id: 'person', ms: MIN, limit: personLimit(stage) }],
  };
}

export const windowStart = (now: number, ms: number) => Math.floor(now / ms) * ms;

/** The TTL handed to the counter: from the window start to its end plus the grace minute. */
export const counterTtl = (ms: number) => ms + COUNTER_GRACE_MS;

/** Whole seconds until the window that started at start ends; at least 1. */
export const retryAfterSeconds = (start: number, ms: number, now: number) => Math.max(1, Math.ceil((start + ms - now) / 1000));

export type WindowCount = { window: LimitWindow; start: number; n: number };
export type HitResult = { ok: boolean; retryAfterSeconds: number };

/** Refused when any window is over its limit; the wait is the longest of the refusing windows. */
export function decide(counts: readonly WindowCount[], now: number): HitResult {
  let wait = 0;
  for (const { window, start, n } of counts) if (n > window.limit) wait = Math.max(wait, retryAfterSeconds(start, window.ms, now));
  return wait > 0 ? { ok: false, retryAfterSeconds: wait } : { ok: true, retryAfterSeconds: 0 };
}

// --- Addresses -------------------------------------------------------------------------------------------------

const V4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HEXTET = /^[0-9a-f]{1,4}$/;

const isV4 = (s: string) => V4.test(s);

/** The 8 hextets of an IPv6 address (an embedded IPv4 tail included), or undefined when it is not one. */
function ipv6Hextets(input: string): number[] | undefined {
  let s = input.toLowerCase();
  // An embedded IPv4 tail (::ffff:192.0.2.10) becomes its two hextets.
  const lastColon = s.lastIndexOf(':');
  const v4 = s.slice(lastColon + 1);
  if (lastColon >= 0 && v4.includes('.')) {
    if (!isV4(v4)) return undefined;
    const [a, b, c, d] = v4.split('.').map(Number) as [number, number, number, number];
    s = `${s.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return undefined;
  const parse = (part: string) => (part === '' ? [] : part.split(':'));
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  if (![...head, ...rest].every((h) => HEXTET.test(h))) return undefined;
  const given = head.length + rest.length;
  if (halves.length === 2 ? given > 7 : given !== 8) return undefined;
  const zeros = Array<number>(8 - given).fill(0);
  return [...head, ...zeros, ...rest].map((h) => (typeof h === 'number' ? h : parseInt(h, 16)));
}

/** A bare address from one X-Forwarded-For entry: [v6]:port and v4:port lose the port. Undefined when invalid. */
function parseAddress(entry: string): string | undefined {
  let s = entry.trim();
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(s);
  if (bracketed) s = bracketed[1]!;
  else if (/^[\d.]+:\d{1,5}$/.test(s)) s = s.slice(0, s.indexOf(':'));
  if (isV4(s)) return s;
  if (s.includes(':') && ipv6Hextets(s)) return s.toLowerCase();
  return undefined;
}

/**
 * The client address: the right-most X-Forwarded-For entry, the one Amplify's CDN appends (architecture.md "Auth flows").
 * Left entries are whatever the client sent and are never used, even when the right-most one is unusable.
 */
export function clientIp(forwardedFor: string | null | undefined): string | undefined {
  if (!forwardedFor) return undefined;
  const entries = forwardedFor.split(',');
  return parseAddress(entries[entries.length - 1]!);
}

const hex4 = (n: number) => n.toString(16).padStart(4, '0');

/** The IPv4 /24 (a.b.c.0/24) or the IPv6 /48 (xxxx:xxxx:xxxx::/48); IPv4-mapped IPv6 counts as its IPv4. */
export function addressPrefix(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  if (isV4(ip)) return `${ip.split('.').slice(0, 3).join('.')}.0/24`;
  const h = ipv6Hextets(ip);
  if (!h) return undefined;
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
    return `${h[6]! >> 8}.${h[6]! & 0xff}.${h[7]! >> 8}.0/24`;
  }
  return `${h.slice(0, 3).map(hex4).join(':')}::/48`;
}

// --- Keys --------------------------------------------------------------------------------------------------------

/** Emails are counted as the sign-in login is: trimmed and lower-cased. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** No usable address: one shared bucket, so a request without one is still counted. */
const UNKNOWN = 'unknown';

/** The plain text a counter counts, before the HMAC. Never stored or logged. */
export function counterSubject<S extends LimitScope>(scope: S, value: LimitInput[S]): string {
  switch (scope) {
    case 'ip-auth':
      return addressPrefix(value as LimitInput['ip-auth']) ?? UNKNOWN;
    case 'auth-fail': {
      const { email, ip } = value as LimitInput['auth-fail'];
      return `${normalizeEmail(email)}|${addressPrefix(ip) ?? UNKNOWN}`;
    }
    case 'code-email':
      return normalizeEmail(value as LimitInput['code-email']);
    case 'person':
      return value as LimitInput['person'];
  }
  throw new Error(`unknown limit scope ${String(scope)}`);
}

/** HMAC-SHA256 of the subject under the stage's HMAC secret, base64url (D-115). */
export const hmacValue = (secret: string, subject: string) => createHmac('sha256', secret).update(subject).digest('base64url');

/** The counter key without its window start: RL#<window id>#<value>. The adapter appends #<window start>. */
export const counterKey = (windowId: string, value: string) => `RL#${windowId}#${value}`;
