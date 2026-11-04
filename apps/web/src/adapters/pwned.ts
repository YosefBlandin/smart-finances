import { createHash } from 'node:crypto';
import type { BreachChecker } from '@/ports/breach-checker';
import type { Logger } from '@/ports/logger';

/** The one call this adapter makes; tests pass a hand-written fake, production the runtime's fetch. */
export type PwnedFetch = (
  url: string,
  init: { method: 'GET'; headers: Record<string, string>; signal: AbortSignal; cache: 'no-store'; redirect: 'error' },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 2_000;
const LINE = /^([0-9A-F]{35}):(\d+)$/;

class Timeout extends Error {}
class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

// The Pwned Passwords range API (D-117): only the first 5 hex characters of the password's SHA-1 leave the server
// (k-anonymity); Add-Padding makes every reply about the same size, padding lines carry a count of 0. Any failure
// (HTTP error, network, timeout, a reply that is not a range) accepts the password and logs breach_check_unavailable.
export class PwnedPasswordsChecker implements BreachChecker {
  private readonly logger: Logger;
  private readonly fetch: PwnedFetch;
  private readonly timeoutMs: number;

  constructor({ logger, fetch, timeoutMs = TIMEOUT_MS }: { logger: Logger; fetch?: PwnedFetch; timeoutMs?: number }) {
    this.logger = logger;
    this.fetch = fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.timeoutMs = timeoutMs;
  }

  async isBreached(password: string, context: { sub?: string; requestId: string }): Promise<boolean | 'unavailable'> {
    const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    let text: string;
    try {
      text = await this.range(prefix);
    } catch (e) {
      const outcome = e instanceof Timeout ? 'timeout' : e instanceof HttpError ? `http_${e.status}` : 'network';
      return this.unavailable(outcome, context);
    }
    let lines = 0;
    for (const raw of text.split(/\r?\n/)) {
      const m = LINE.exec(raw.trim().toUpperCase());
      if (!m) continue;
      lines += 1;
      if (m[1] === suffix && Number(m[2]) > 0) return true;
    }
    // A padded range always has hundreds of lines; none at all means this was not the API's answer.
    return lines === 0 ? this.unavailable('bad_reply', context) : false;
  }

  /** One GET with the 2-second budget covering the reply and its body; the request is aborted when it runs out. */
  private async range(prefix: string): Promise<string> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Timeout());
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
      if (!res.ok) throw new HttpError(res.status);
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

  private unavailable(outcome: string, context: { sub?: string; requestId: string }): 'unavailable' {
    this.logger.event('breach_check_unavailable', outcome, context);
    return 'unavailable';
  }
}
