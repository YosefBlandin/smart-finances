import { createHash } from 'node:crypto';
import type { BreachChecker } from '@/ports/breach-checker';

/** The one call this adapter makes; tests pass a hand-written fake, production the runtime's fetch. */
export type PwnedFetch = (
  url: string,
  init: { method: 'GET'; headers: Record<string, string>; signal: AbortSignal; cache: 'no-store'; redirect: 'error' },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 2_000;
const LINE = /^([0-9A-F]{35}):(\d+)$/;

// The Pwned Passwords range API (D-117): only the first 5 hex characters of the password's SHA-1 leave the server
// (k-anonymity); Add-Padding makes every reply about the same size, padding lines carry a count of 0. Any failure
// (HTTP error, network, timeout, a reply that is not a range) answers 'unavailable': the caller accepts the password
// and logs breach_check_unavailable with its request id (the port is isBreached(password), architecture.md "Ports").
export class PwnedPasswordsChecker implements BreachChecker {
  private readonly fetch: PwnedFetch;
  private readonly timeoutMs: number;

  constructor({ fetch, timeoutMs = TIMEOUT_MS }: { fetch?: PwnedFetch; timeoutMs?: number } = {}) {
    this.fetch = fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.timeoutMs = timeoutMs;
  }

  async isBreached(password: string): Promise<boolean | 'unavailable'> {
    const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    let text: string;
    try {
      text = await this.range(prefix);
    } catch {
      return 'unavailable';
    }
    let lines = 0;
    for (const raw of text.split(/\r?\n/)) {
      const m = LINE.exec(raw.trim().toUpperCase());
      if (!m) continue;
      lines += 1;
      if (m[1] === suffix && Number(m[2]) > 0) return true;
    }
    // A padded range always has hundreds of lines; none at all means this was not the API's answer.
    return lines === 0 ? 'unavailable' : false;
  }

  /** One GET with the 2-second budget covering the reply and its body; the request is aborted when it runs out. */
  private async range(prefix: string): Promise<string> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('timeout'));
      }, this.timeoutMs);
    });
    const request = (async () => {
      const res = await this.fetch(RANGE_URL + prefix, {
        method: 'GET',
        headers: { 'Add-Padding': 'true' },
        signal: controller.signal,
        // Never Next.js's data cache, and never a redirect to another host.
        cache: 'no-store',
        redirect: 'error',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    })();
    // The losing promise's rejection is handled, so an abort after the timeout raises nothing unhandled.
    request.catch(() => {});
    try {
      return await Promise.race([request, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
