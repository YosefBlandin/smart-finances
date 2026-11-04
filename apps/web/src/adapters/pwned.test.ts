import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryBreachChecker } from './memory/breach-checker';
import { MemoryLogger } from './memory/logger';
import { PwnedPasswordsChecker, type PwnedFetch } from './pwned';

// SHA-1("P@ssw0rd") = 21BD12DC183F740EE76F27B78EB39C8AD972A757, a well-known breached example; synthetic passwords only.
const PW = 'P@ssw0rd';
const PREFIX = '21BD1';
const SUFFIX = '2DC183F740EE76F27B78EB39C8AD972A757';
const CTX = { requestId: 'req-test-1' };

type Call = { url: string; init: Parameters<PwnedFetch>[1] };

/** A range reply: padding lines (count 0) around the given lines, CRLF as the API sends them. */
function body(lines: string[]): string {
  const pad = Array.from({ length: 4 }, (_, i) => `${String(i).repeat(35).slice(0, 35)}:0`);
  return [...pad.slice(0, 2), ...lines, ...pad.slice(2)].join('\r\n');
}

function fakeFetch(reply: (call: Call) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>) {
  const calls: Call[] = [];
  const fetch: PwnedFetch = (url, init) => {
    const call = { url, init };
    calls.push(call);
    return reply(call);
  };
  return { fetch, calls };
}

/** The one call made; fails the test when there was not exactly one. */
function only(calls: Call[]): Call {
  expect(calls).toHaveLength(1);
  const [call] = calls;
  if (!call) throw new Error('no call');
  return call;
}

const okReply = (text: string) => async () => ({ ok: true, status: 200, text: async () => text });

function checker(fetch: PwnedFetch, timeoutMs?: number) {
  const logger = new MemoryLogger();
  return { logger, checker: new PwnedPasswordsChecker({ logger, fetch, timeoutMs }) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('PwnedPasswordsChecker (D-117)', () => {
  it('T-WAUTH-8: asks the range API with only the first 5 upper-case SHA-1 characters and Add-Padding', async () => {
    const f = fakeFetch(okReply(body([])));
    const { checker: c } = checker(f.fetch);
    await c.isBreached(PW, CTX);
    const call = only(f.calls);
    expect(call.url).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`);
    expect(call.init.method).toBe('GET');
    expect(call.init.headers['Add-Padding']).toBe('true');
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
    // Nothing but the prefix leaves: not the password, the suffix or the full hash, in any case.
    const sent = JSON.stringify({ url: call.url, headers: call.init.headers }).toUpperCase();
    expect(sent).not.toContain(SUFFIX);
    expect(sent).not.toContain(SUFFIX.slice(0, 6));
    expect(sent).not.toContain(PW.toUpperCase());
    expect(Object.keys(call.init)).not.toContain('body');
  });

  it('T-WAUTH-8: hashes the UTF-8 bytes and upper-cases the prefix for any password', async () => {
    const f = fakeFetch(okReply(body([])));
    const { checker: c } = checker(f.fetch);
    const pw = 'contraseña de prueba ñandú';
    await c.isBreached(pw, CTX);
    const hex = createHash('sha1').update(Buffer.from(pw, 'utf8')).digest('hex').toUpperCase();
    const call = only(f.calls);
    expect(call.url).toBe(`https://api.pwnedpasswords.com/range/${hex.slice(0, 5)}`);
    expect(call.url).toMatch(/\/range\/[0-9A-F]{5}$/);
  });

  it('T-WAUTH-8: a breached password is refused when its suffix appears with a count', async () => {
    const f = fakeFetch(okReply(body([`0018A45C4D1DEF81644B54AB7F969B88D65:3`, `${SUFFIX}:10434004`])));
    const { checker: c, logger } = checker(f.fetch);
    expect(await c.isBreached(PW, CTX)).toBe(true);
    expect(logger.events).toEqual([]);
  });

  it('T-WAUTH-8: the suffix matches whatever the case and line ending of the reply', async () => {
    const f = fakeFetch(okReply(`${SUFFIX.toLowerCase()}:2\n00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2\n`));
    const { checker: c } = checker(f.fetch);
    expect(await c.isBreached(PW, CTX)).toBe(true);
  });

  it('T-WAUTH-8: a password whose suffix is absent, or only a padding line (count 0), is accepted', async () => {
    const absent = checker(fakeFetch(okReply(body(['0018A45C4D1DEF81644B54AB7F969B88D65:3']))).fetch);
    expect(await absent.checker.isBreached(PW, CTX)).toBe(false);
    const padded = checker(fakeFetch(okReply(body([`${SUFFIX}:0`]))).fetch);
    expect(await padded.checker.isBreached(PW, CTX)).toBe(false);
    expect(absent.logger.events).toEqual([]);
    expect(padded.logger.events).toEqual([]);
  });

  it.each([
    ['an HTTP error', async () => ({ ok: false, status: 503, text: async () => 'Service Unavailable' }), 'http_503'],
    ['a rate limit', async () => ({ ok: false, status: 429, text: async () => '' }), 'http_429'],
    [
      'a network failure',
      async () => {
        throw new TypeError('fetch failed');
      },
      'network',
    ],
    ['an empty reply', async () => ({ ok: true, status: 200, text: async () => '' }), 'bad_reply'],
    ['a reply that is not a range', async () => ({ ok: true, status: 200, text: async () => '<html>maintenance</html>' }), 'bad_reply'],
    [
      'a body that fails to read',
      async () => ({
        ok: true,
        status: 200,
        text: async () => {
          throw new TypeError('terminated');
        },
      }),
      'network',
    ],
  ])('T-WAUTH-8: %s accepts the password and logs breach_check_unavailable', async (_name, reply, outcome) => {
    const { checker: c, logger } = checker(fakeFetch(reply).fetch);
    expect(await c.isBreached(PW, { requestId: 'req-test-2', sub: '00000000-0000-4000-8000-000000000001' })).toBe('unavailable');
    expect(logger.events).toEqual([
      { name: 'breach_check_unavailable', outcome, requestId: 'req-test-2', sub: '00000000-0000-4000-8000-000000000001' },
    ]);
    // The log line carries no password and no part of its hash.
    const logged = JSON.stringify(logger.events).toUpperCase();
    expect(logged).not.toContain(PW.toUpperCase());
    expect(logged).not.toContain(PREFIX);
  });

  it('T-WAUTH-8: no answer within 2 seconds aborts the request, accepts and logs a timeout', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const f = fakeFetch(
      ({ init }) =>
        new Promise((_resolve, reject) => {
          signal = init.signal;
          init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const { checker: c, logger } = checker(f.fetch);
    let result: boolean | 'unavailable' | undefined;
    void c.isBreached(PW, CTX).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(1999);
    expect(result).toBeUndefined();
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    expect(result).toBe('unavailable');
    expect(logger.events).toEqual([{ name: 'breach_check_unavailable', outcome: 'timeout', requestId: 'req-test-1', sub: undefined }]);
  });

  it('T-WAUTH-8: the 2 seconds cover reading the body too', async () => {
    vi.useFakeTimers();
    const f = fakeFetch(async ({ init }) => ({
      ok: true,
      status: 200,
      text: () =>
        new Promise<string>((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    }));
    const { checker: c, logger } = checker(f.fetch);
    const pending = c.isBreached(PW, CTX);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBe('unavailable');
    expect(logger.events.map((e) => e.outcome)).toEqual(['timeout']);
  });

  it('T-WAUTH-8: a fetch that ignores the abort still gives up at 2 seconds', async () => {
    vi.useFakeTimers();
    const f = fakeFetch(() => new Promise(() => {}));
    const { checker: c, logger } = checker(f.fetch);
    const pending = c.isBreached(PW, CTX);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBe('unavailable');
    expect(logger.events.map((e) => e.outcome)).toEqual(['timeout']);
  });

  it('T-WAUTH-8: an answer in time clears the timer, so no late abort or log follows', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const f = fakeFetch(async ({ init }) => {
      signal = init.signal;
      return { ok: true, status: 200, text: async () => body([]) };
    });
    const { checker: c, logger } = checker(f.fetch);
    expect(await c.isBreached(PW, CTX)).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(signal?.aborted).toBe(false);
    expect(logger.events).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('MemoryBreachChecker logs like the real one', () => {
  it('T-WAUTH-8: the memory fake accepts and logs breach_check_unavailable when unavailable', async () => {
    const logger = new MemoryLogger();
    const fake = new MemoryBreachChecker(logger);
    fake.add('password1234');
    expect(await fake.isBreached('password1234', CTX)).toBe(true);
    expect(await fake.isBreached('a fresh password', CTX)).toBe(false);
    expect(logger.events).toEqual([]);
    fake.setUnavailable(true);
    expect(await fake.isBreached('a fresh password', CTX)).toBe('unavailable');
    expect(logger.events).toEqual([{ name: 'breach_check_unavailable', outcome: 'unavailable', requestId: 'req-test-1', sub: undefined }]);
  });
});
