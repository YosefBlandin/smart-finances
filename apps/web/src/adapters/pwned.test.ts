import { createHash } from 'node:crypto';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { BreachChecker } from '@/ports/breach-checker';
import { MemoryBreachChecker } from './memory/breach-checker';
import { PwnedPasswordsChecker, type PwnedFetch } from './pwned';

// SHA-1("P@ssw0rd") = 21BD12DC183F740EE76F27B78EB39C8AD972A757, a well-known breached example; synthetic passwords only.
const PW = 'P@ssw0rd';
const PREFIX = '21BD1';
const SUFFIX = '2DC183F740EE76F27B78EB39C8AD972A757';

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
  return { checker: new PwnedPasswordsChecker({ fetch, timeoutMs }) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('PwnedPasswordsChecker (D-117)', () => {
  it('T-WAUTH-8: asks the range API with only the first 5 upper-case SHA-1 characters and Add-Padding', async () => {
    const f = fakeFetch(okReply(body([])));
    const { checker: c } = checker(f.fetch);
    await c.isBreached(PW);
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
    await c.isBreached(pw);
    const hex = createHash('sha1').update(Buffer.from(pw, 'utf8')).digest('hex').toUpperCase();
    const call = only(f.calls);
    expect(call.url).toBe(`https://api.pwnedpasswords.com/range/${hex.slice(0, 5)}`);
    expect(call.url).toMatch(/\/range\/[0-9A-F]{5}$/);
  });

  it('T-WAUTH-8: a breached password is refused when its suffix appears with a count', async () => {
    const f = fakeFetch(okReply(body([`0018A45C4D1DEF81644B54AB7F969B88D65:3`, `${SUFFIX}:10434004`])));
    const { checker: c } = checker(f.fetch);
    expect(await c.isBreached(PW)).toBe(true);
  });

  it('T-WAUTH-8: the suffix matches whatever the case and line ending of the reply', async () => {
    const f = fakeFetch(okReply(`${SUFFIX.toLowerCase()}:2\n00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2\n`));
    const { checker: c } = checker(f.fetch);
    expect(await c.isBreached(PW)).toBe(true);
  });

  it('T-WAUTH-8: a password whose suffix is absent, or only a padding line (count 0), is accepted', async () => {
    const absent = checker(fakeFetch(okReply(body(['0018A45C4D1DEF81644B54AB7F969B88D65:3']))).fetch);
    expect(await absent.checker.isBreached(PW)).toBe(false);
    const padded = checker(fakeFetch(okReply(body([`${SUFFIX}:0`]))).fetch);
    expect(await padded.checker.isBreached(PW)).toBe(false);
  });

  it.each([
    ['an HTTP error', async () => ({ ok: false, status: 503, text: async () => 'Service Unavailable' })],
    ['a rate limit', async () => ({ ok: false, status: 429, text: async () => '' })],
    [
      'a network failure',
      async () => {
        throw new TypeError('fetch failed');
      },
    ],
    ['an empty reply', async () => ({ ok: true, status: 200, text: async () => '' })],
    ['a reply that is not a range', async () => ({ ok: true, status: 200, text: async () => '<html>maintenance</html>' })],
    [
      'a body that fails to read',
      async () => ({
        ok: true,
        status: 200,
        text: async () => {
          throw new TypeError('terminated');
        },
      }),
    ],
  ])('T-WAUTH-8: %s answers unavailable, so the caller accepts the password and logs breach_check_unavailable', async (_name, reply) => {
    const { checker: c } = checker(fakeFetch(reply).fetch);
    await expect(c.isBreached(PW)).resolves.toBe('unavailable');
  });

  it('T-WAUTH-8: no answer within 2 seconds aborts the request and answers unavailable', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const f = fakeFetch(
      ({ init }) =>
        new Promise((_resolve, reject) => {
          signal = init.signal;
          init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const { checker: c } = checker(f.fetch);
    let result: boolean | 'unavailable' | undefined;
    void c.isBreached(PW).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(1999);
    expect(result).toBeUndefined();
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    expect(result).toBe('unavailable');
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
    const { checker: c } = checker(f.fetch);
    const pending = c.isBreached(PW);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBe('unavailable');
  });

  it('T-WAUTH-8: a fetch that ignores the abort still gives up at 2 seconds', async () => {
    vi.useFakeTimers();
    const f = fakeFetch(() => new Promise(() => {}));
    const { checker: c } = checker(f.fetch);
    const pending = c.isBreached(PW);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBe('unavailable');
  });

  it('T-WAUTH-8: an answer in time clears the timer, so no late abort follows', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const f = fakeFetch(async ({ init }) => {
      signal = init.signal;
      return { ok: true, status: 200, text: async () => body([]) };
    });
    const { checker: c } = checker(f.fetch);
    expect(await c.isBreached(PW)).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(signal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('BreachChecker keeps the Contracts port (architecture.md "Ports")', () => {
  it('T-WAUTH-8: isBreached(password) takes the password only, for the port, the real checker and the memory fake', () => {
    expectTypeOf<BreachChecker['isBreached']>().parameters.toEqualTypeOf<[password: string]>();
    expectTypeOf<BreachChecker['isBreached']>().returns.toEqualTypeOf<Promise<boolean | 'unavailable'>>();
    expectTypeOf<PwnedPasswordsChecker['isBreached']>().parameters.toEqualTypeOf<[password: string]>();
    expectTypeOf<MemoryBreachChecker['isBreached']>().parameters.toEqualTypeOf<[password: string]>();
    // Logging the miss is the caller's, with its request id: the checker is built without a logger.
    expect(PwnedPasswordsChecker.length).toBe(0);
    expect(new PwnedPasswordsChecker().isBreached.length).toBe(1);
    expect(new MemoryBreachChecker().isBreached.length).toBe(1);
  });

  it('T-WAUTH-8: the memory fake refuses added passwords and answers unavailable when set so', async () => {
    const fake = new MemoryBreachChecker();
    fake.add('password1234');
    expect(await fake.isBreached('password1234')).toBe(true);
    expect(await fake.isBreached('a fresh password')).toBe(false);
    fake.setUnavailable(true);
    expect(await fake.isBreached('a fresh password')).toBe('unavailable');
  });
});
