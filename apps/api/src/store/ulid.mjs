// ULIDs for import ids: 48 bits of milliseconds and 80 random bits in Crockford base32, so ids
// sort by creation time. Monotonic: ids made in the same millisecond still sort in order.
import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const MAX_TIME = 2 ** 48 - 1;

function encodeTime(ms) {
  let out = '';
  let t = ms;
  for (let i = 0; i < 10; i += 1) {
    out = ALPHABET[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return out;
}

// 80 random bits as 16 base32 digits, kept as digit values so they can be incremented.
const randomDigits = () => [...randomBytes(16)].map((b) => b % 32);

function increment(digits) {
  const next = [...digits];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    if (next[i] < 31) {
      next[i] += 1;
      return next;
    }
    next[i] = 0;
  }
  throw new Error('ulid random part overflowed within one millisecond');
}

export function createUlid({ random = randomDigits } = {}) {
  let lastTime = -1;
  let lastDigits = [];
  return function ulid(now = Date.now()) {
    const ms = Math.floor(now);
    if (!Number.isInteger(ms) || ms < 0 || ms > MAX_TIME) throw new Error('ulid time out of range');
    if (ms <= lastTime) lastDigits = increment(lastDigits);
    else {
      lastTime = ms;
      lastDigits = random();
    }
    return encodeTime(Math.max(ms, lastTime)) + lastDigits.map((d) => ALPHABET[d]).join('');
  };
}

export const ulid = createUlid();
