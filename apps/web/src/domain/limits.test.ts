/* eslint-disable import/no-restricted-paths -- T-WAUTH-5 is the task's one test file and covers the windows end to
   end, so it also drives the hit() use case and the DynamoDB counter adapter; no production domain code imports these. */
import { describe, expect, it } from 'vitest';
import { createLimits } from '@/application/limits';
import { DynamoCounter } from '@/adapters/dynamodb/counters';
import type { DocClient } from '@/adapters/dynamodb/sessions';
import { MemoryClock } from '@/adapters/memory/clock';
import { MemoryCounter } from '@/adapters/memory/counter';
import { MemorySecretStore } from '@/adapters/memory/secret-store';
import { MemorySettings, TEST_SETTINGS } from '@/adapters/memory/settings';
import type { Counter } from '@/ports/counter';
import type { WebSettings } from '@/ports/settings';
import {
  COUNTER_GRACE_MS,
  addressPrefix,
  clientIp,
  counterKey,
  counterSubject,
  hmacValue,
  limitsFor,
  normalizeEmail,
  retryAfterSeconds,
  windowStart,
} from './limits';

// T-WAUTH-5 (AC-17, D-120, D-115): counters refuse at each limit and reset at the window edge; keys hold no raw
// email or IP. Synthetic values only: example.test addresses, documentation-range addresses (192.0.2.0/24,
// 198.51.100.0/24, 2001:db8::/32), made-up subs. No AWS call: the DynamoDB adapter gets a hand-written fake client.
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// A day boundary (a multiple of every window), so the edges below are easy to read.
const T0 = 20_000 * DAY;
const EMAIL = 'person@example.test';
const OTHER_EMAIL = 'someone@example.test';
const IP = '192.0.2.10';
const SAME_PREFIX_IP = '192.0.2.200';
const OTHER_IP = '198.51.100.7';
const SUB_A = '00000000-0000-4000-8000-000000000001';
const SUB_B = '00000000-0000-4000-8000-000000000002';

const prodSettings = new MemorySettings({ ...TEST_SETTINGS, STAGE: 'prod' } satisfies WebSettings);

/** Records every key a counter is asked to count, around a real memory counter. */
class SpyCounter implements Counter {
  readonly calls: { key: string; windowStart: number; ttl: number }[] = [];
  constructor(private readonly inner: Counter) {}
  incr(key: string, start: number, ttl: number) {
    this.calls.push({ key, windowStart: start, ttl });
    return this.inner.incr(key, start, ttl);
  }
}

function setup(settings = prodSettings, start = T0) {
  const clock = new MemoryClock(start);
  const counter = new SpyCounter(new MemoryCounter(clock));
  const secretStore = new MemorySecretStore();
  const limits = createLimits({ counter, clock, secretStore, settings });
  return { clock, counter, secretStore, limits };
}

async function hitTimes<T>(n: number, fn: () => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(await fn());
  return out;
}

describe('T-WAUTH-5 window math', () => {
  it('T-WAUTH-5 window start is floor(now / window) * window', () => {
    expect(windowStart(T0, 5 * MIN)).toBe(T0);
    expect(windowStart(T0 + 5 * MIN - 1, 5 * MIN)).toBe(T0);
    expect(windowStart(T0 + 5 * MIN, 5 * MIN)).toBe(T0 + 5 * MIN);
    expect(windowStart(T0 + 7 * MIN + 3, 5 * MIN)).toBe(T0 + 5 * MIN);
    expect(windowStart(T0 + 23 * HOUR, DAY)).toBe(T0);
  });

  it('T-WAUTH-5 the wait is what is left of the window, rounded up to whole seconds, never 0', () => {
    expect(retryAfterSeconds(T0, 5 * MIN, T0)).toBe(300);
    expect(retryAfterSeconds(T0, 5 * MIN, T0 + 1)).toBe(300);
    expect(retryAfterSeconds(T0, 5 * MIN, T0 + 5 * MIN - 1)).toBe(1);
    expect(retryAfterSeconds(T0, 5 * MIN, T0 + 299_500)).toBe(1);
  });

  it('T-WAUTH-5 the limits are the Contracts "Limits" table; STAGE=test lets a person make 5 data requests a minute', () => {
    expect(limitsFor('prod')).toEqual({
      'ip-auth': [{ id: 'ip-auth', ms: 5 * MIN, limit: 20 }],
      'auth-fail': [{ id: 'auth-fail', ms: 15 * MIN, limit: 5 }],
      'code-email': [
        { id: 'code-email-1h', ms: HOUR, limit: 3 },
        { id: 'code-email-1d', ms: DAY, limit: 10 },
      ],
      person: [{ id: 'person', ms: MIN, limit: 120 }],
    });
    expect(limitsFor('qa')).toEqual(limitsFor('prod'));
    expect(limitsFor('staging')).toEqual(limitsFor('prod'));
    expect(limitsFor('test').person).toEqual([{ id: 'person', ms: MIN, limit: 5 }]);
    expect(limitsFor('test')['ip-auth']).toEqual(limitsFor('prod')['ip-auth']);
    expect(COUNTER_GRACE_MS).toBe(MIN);
  });
});

describe('T-WAUTH-5 client address and prefix', () => {
  it('T-WAUTH-5 the client address is the right-most X-Forwarded-For entry, never the left-most', () => {
    expect(clientIp('203.0.113.99, 198.51.100.7, 192.0.2.10')).toBe(IP);
    expect(clientIp(' 192.0.2.10 ')).toBe(IP);
    expect(clientIp('evil, 192.0.2.10')).toBe(IP);
    expect(clientIp('192.0.2.10:443')).toBe(IP);
    expect(clientIp('2001:db8::1, 2001:DB8:aa:bb::5')).toBe('2001:db8:aa:bb::5');
    expect(clientIp('[2001:db8::1]:8443')).toBe('2001:db8::1');
  });

  it('T-WAUTH-5 a missing, empty or unparseable right-most entry gives no address (a spoofed left entry is not used)', () => {
    expect(clientIp(undefined)).toBeUndefined();
    expect(clientIp(null)).toBeUndefined();
    expect(clientIp('')).toBeUndefined();
    expect(clientIp('192.0.2.10, ')).toBeUndefined();
    expect(clientIp('192.0.2.10, not-an-ip')).toBeUndefined();
    expect(clientIp('192.0.2.10, 999.0.2.1')).toBeUndefined();
    expect(clientIp('192.0.2.10, 2001:db8::1::2')).toBeUndefined();
  });

  it('T-WAUTH-5 the address prefix is the IPv4 /24 or the IPv6 /48', () => {
    expect(addressPrefix(IP)).toBe('192.0.2.0/24');
    expect(addressPrefix(SAME_PREFIX_IP)).toBe('192.0.2.0/24');
    expect(addressPrefix(OTHER_IP)).toBe('198.51.100.0/24');
    expect(addressPrefix('2001:db8:aa:bb::5')).toBe('2001:0db8:00aa::/48');
    expect(addressPrefix('2001:DB8:AA:ffff:1:2:3:4')).toBe('2001:0db8:00aa::/48');
    expect(addressPrefix('2001:db8::1')).toBe('2001:0db8:0000::/48');
    expect(addressPrefix('::1')).toBe('0000:0000:0000::/48');
    expect(addressPrefix('::ffff:192.0.2.10')).toBe('192.0.2.0/24');
    expect(addressPrefix('not-an-ip')).toBeUndefined();
    expect(addressPrefix(undefined)).toBeUndefined();
  });
});

describe('T-WAUTH-5 counter keys', () => {
  it('T-WAUTH-5 subjects: the address prefix, the lower-cased email with the prefix, the email, or the sub', () => {
    expect(normalizeEmail('  Person@Example.TEST ')).toBe(EMAIL);
    expect(counterSubject('ip-auth', IP)).toBe('192.0.2.0/24');
    expect(counterSubject('ip-auth', undefined)).toBe('unknown');
    expect(counterSubject('auth-fail', { email: ' Person@Example.test', ip: SAME_PREFIX_IP })).toBe(`${EMAIL}|192.0.2.0/24`);
    expect(counterSubject('auth-fail', { email: EMAIL, ip: undefined })).toBe(`${EMAIL}|unknown`);
    expect(counterSubject('code-email', 'PERSON@example.test')).toBe(EMAIL);
    expect(counterSubject('person', SUB_A)).toBe(SUB_A);
  });

  it('T-WAUTH-5 the value is HMAC-SHA256 base64url of the subject under the secret; the key is RL#<window>#<value>', () => {
    const v = hmacValue('test-hmac-secret', EMAIL);
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hmacValue('test-hmac-secret', EMAIL)).toBe(v);
    expect(hmacValue('another-secret', EMAIL)).not.toBe(v);
    expect(hmacValue('test-hmac-secret', OTHER_EMAIL)).not.toBe(v);
    expect(counterKey('auth-fail', v)).toBe(`RL#auth-fail#${v}`);
  });

  it('T-WAUTH-5 keys sent to the counter hold no raw email, address, prefix or sub', async () => {
    const { limits, counter } = setup();
    await limits.hit('ip-auth', IP);
    await limits.hit('auth-fail', { email: EMAIL, ip: IP });
    await limits.hit('code-email', EMAIL);
    await limits.hit('person', SUB_A);
    expect(counter.calls).toHaveLength(5);
    for (const { key } of counter.calls) {
      expect(key).toMatch(/^RL#(ip-auth|auth-fail|code-email-1h|code-email-1d|person)#[A-Za-z0-9_-]{43}$/);
      const value = key.split('#')[2]!;
      for (const raw of [EMAIL, 'person@', 'example', IP, '192.0.2', SUB_A, '00000000']) expect(value).not.toContain(raw);
    }
  });

  it('T-WAUTH-5 the HMAC key is the secret at HMAC_SECRET_ARN', async () => {
    const a = setup();
    const b = setup();
    b.secretStore.set(TEST_SETTINGS.HMAC_SECRET_ARN, 'a-different-test-secret');
    await a.limits.hit('person', SUB_A);
    await b.limits.hit('person', SUB_A);
    expect(a.counter.calls[0]!.key).toBe(`RL#person#${hmacValue('test-hmac-secret', SUB_A)}`);
    expect(b.counter.calls[0]!.key).toBe(`RL#person#${hmacValue('a-different-test-secret', SUB_A)}`);
  });

  it('T-WAUTH-5 each count goes to its window start with a TTL of the window plus one minute', async () => {
    const { limits, counter } = setup(prodSettings, T0 + 7 * MIN + 3);
    await limits.hit('ip-auth', IP);
    await limits.hit('code-email', EMAIL);
    expect(counter.calls.map(({ windowStart: s, ttl }) => [s, ttl])).toEqual([
      [T0 + 5 * MIN, 5 * MIN + MIN],
      [T0, HOUR + MIN],
      [T0, DAY + MIN],
    ]);
  });
});

describe('T-WAUTH-5 hit() refuses at each limit and resets at the window edge', () => {
  it('T-WAUTH-5 auth posts per address: 20 per 5-minute window, then a refusal with the wait', async () => {
    const { limits, clock } = setup(prodSettings, T0 + 2 * MIN);
    const ok = await hitTimes(20, () => limits.hit('ip-auth', IP));
    expect(ok.every((r) => r.ok && r.retryAfterSeconds === 0)).toBe(true);
    expect(await limits.hit('ip-auth', IP)).toEqual({ ok: false, retryAfterSeconds: 180 });
    // Same /24: the same counter.
    expect(await limits.hit('ip-auth', SAME_PREFIX_IP)).toEqual({ ok: false, retryAfterSeconds: 180 });
    // Another address is not slowed.
    expect(await limits.hit('ip-auth', OTHER_IP)).toEqual({ ok: true, retryAfterSeconds: 0 });
    clock.set(T0 + 5 * MIN - 1);
    expect(await limits.hit('ip-auth', IP)).toEqual({ ok: false, retryAfterSeconds: 1 });
    clock.set(T0 + 5 * MIN);
    expect(await limits.hit('ip-auth', IP)).toEqual({ ok: true, retryAfterSeconds: 0 });
  });

  it('T-WAUTH-5 failures per email and address prefix: 5 per 15-minute window', async () => {
    const { limits, clock } = setup();
    const fail = { email: EMAIL, ip: IP };
    expect((await hitTimes(5, () => limits.hit('auth-fail', fail))).every((r) => r.ok)).toBe(true);
    expect(await limits.hit('auth-fail', fail)).toEqual({ ok: false, retryAfterSeconds: 900 });
    // The same email in another case, from the same /24: the same counter.
    expect((await limits.hit('auth-fail', { email: 'PERSON@example.test', ip: SAME_PREFIX_IP })).ok).toBe(false);
    // The same email from another prefix, or another email from the same prefix: separate counters.
    expect((await limits.hit('auth-fail', { email: EMAIL, ip: OTHER_IP })).ok).toBe(true);
    expect((await limits.hit('auth-fail', { email: OTHER_EMAIL, ip: IP })).ok).toBe(true);
    clock.set(T0 + 15 * MIN - 1);
    expect(await limits.hit('auth-fail', fail)).toEqual({ ok: false, retryAfterSeconds: 1 });
    clock.set(T0 + 15 * MIN);
    expect(await limits.hit('auth-fail', fail)).toEqual({ ok: true, retryAfterSeconds: 0 });
  });

  it('T-WAUTH-5 code emails per email: 3 an hour and 10 a day', async () => {
    const { limits, clock } = setup();
    expect((await hitTimes(3, () => limits.hit('code-email', EMAIL))).every((r) => r.ok)).toBe(true);
    expect(await limits.hit('code-email', EMAIL)).toEqual({ ok: false, retryAfterSeconds: 3600 });
    expect((await limits.hit('code-email', OTHER_EMAIL)).ok).toBe(true);
    // Hours 2 and 3: 3 more each. The refused try above counted too, so the day holds 10 after them.
    clock.set(T0 + HOUR);
    expect((await hitTimes(3, () => limits.hit('code-email', EMAIL))).every((r) => r.ok)).toBe(true);
    clock.set(T0 + 2 * HOUR);
    expect((await hitTimes(3, () => limits.hit('code-email', EMAIL))).every((r) => r.ok)).toBe(true);
    // The 11th of the day is refused although a later hour has room; the wait is to the end of the day.
    clock.set(T0 + 5 * HOUR);
    expect(await limits.hit('code-email', EMAIL)).toEqual({ ok: false, retryAfterSeconds: 19 * 3600 });
    clock.set(T0 + DAY - 1);
    expect((await limits.hit('code-email', EMAIL)).ok).toBe(false);
    clock.set(T0 + DAY);
    expect(await limits.hit('code-email', EMAIL)).toEqual({ ok: true, retryAfterSeconds: 0 });
  });

  it('T-WAUTH-5 when both code-email windows are full the wait is the longer one', async () => {
    const { limits, clock } = setup();
    for (const h of [0, 1, 2]) {
      clock.set(T0 + h * HOUR);
      await hitTimes(3, () => limits.hit('code-email', EMAIL));
    }
    // Hour 3: the 10th of the day passes, then the day is full, then the hour is full too.
    clock.set(T0 + 3 * HOUR);
    expect((await limits.hit('code-email', EMAIL)).ok).toBe(true);
    expect(await limits.hit('code-email', EMAIL)).toEqual({ ok: false, retryAfterSeconds: 21 * 3600 });
    await limits.hit('code-email', EMAIL);
    expect(await limits.hit('code-email', EMAIL)).toEqual({ ok: false, retryAfterSeconds: 21 * 3600 });
  });

  it('T-WAUTH-5 data requests per person: 120 a minute, and one person over the limit does not slow another', async () => {
    const { limits, clock } = setup(prodSettings, T0 + 30 * SEC);
    expect((await hitTimes(120, () => limits.hit('person', SUB_A))).every((r) => r.ok)).toBe(true);
    expect(await limits.hit('person', SUB_A)).toEqual({ ok: false, retryAfterSeconds: 30 });
    expect(await limits.hit('person', SUB_B)).toEqual({ ok: true, retryAfterSeconds: 0 });
    clock.set(T0 + MIN);
    expect((await limits.hit('person', SUB_A)).ok).toBe(true);
  });

  it('T-WAUTH-5 STAGE=test: 5 data requests a minute per person', async () => {
    const { limits, clock } = setup(new MemorySettings(TEST_SETTINGS));
    expect((await hitTimes(5, () => limits.hit('person', SUB_A))).every((r) => r.ok)).toBe(true);
    expect(await limits.hit('person', SUB_A)).toEqual({ ok: false, retryAfterSeconds: 60 });
    clock.set(T0 + MIN);
    expect((await limits.hit('person', SUB_A)).ok).toBe(true);
  });

  it('T-WAUTH-5 an unknown address still counts, in one shared bucket', async () => {
    const { limits } = setup();
    await hitTimes(20, () => limits.hit('ip-auth', undefined));
    expect((await limits.hit('ip-auth', undefined)).ok).toBe(false);
    expect((await limits.hit('ip-auth', IP)).ok).toBe(true);
  });
});

type Item = Record<string, unknown>;

// A hand-written fake of the DynamoDB document client for the counter's one UpdateCommand. It understands exactly the
// expression the adapter writes and throws on anything else, so a changed expression fails loudly.
class FakeCounterTable implements DocClient {
  readonly items = new Map<string, Item>();
  readonly sent: { name: string; input: Item }[] = [];
  failNext?: string;

  async send(command: { input: object }) {
    const name = command.constructor.name;
    const input = structuredClone(command.input) as Item;
    this.sent.push({ name, input });
    if (this.failNext) {
      const e = new Error('fake service error');
      e.name = this.failNext;
      this.failNext = undefined;
      throw e;
    }
    expect(name).toBe('UpdateCommand');
    expect(input.TableName).toBe('sessions-test');
    expect(input.UpdateExpression).toBe('ADD #n :one SET #expires_at = :expires_at');
    expect(input.ExpressionAttributeNames).toEqual({ '#n': 'n', '#expires_at': 'expires_at' });
    expect(input.ReturnValues).toBe('UPDATED_NEW');
    const pk = (input.Key as { pk: string }).pk;
    const values = input.ExpressionAttributeValues as { ':one': number; ':expires_at': number };
    expect(values[':one']).toBe(1);
    const cur = this.items.get(pk);
    const next = { pk, n: ((cur?.n as number | undefined) ?? 0) + 1, expires_at: values[':expires_at'] };
    this.items.set(pk, next);
    return { Attributes: { n: next.n, expires_at: next.expires_at } };
  }
}

describe('T-WAUTH-5 the DynamoDB counter adapter', () => {
  it('T-WAUTH-5 incr adds one to RL#<scope>#<value>#<window start> and sets expires_at to the window end plus one minute, in seconds', async () => {
    const table = new FakeCounterTable();
    const counter = new DynamoCounter({ client: table, tableName: 'sessions-test' });
    const start = T0 + 5 * MIN;
    expect(await counter.incr('RL#ip-auth#abc', start, 5 * MIN + COUNTER_GRACE_MS)).toBe(1);
    expect(await counter.incr('RL#ip-auth#abc', start, 5 * MIN + COUNTER_GRACE_MS)).toBe(2);
    expect(table.sent[0]!.input.Key).toEqual({ pk: `RL#ip-auth#abc#${start}` });
    expect(table.items.get(`RL#ip-auth#abc#${start}`)).toEqual({
      pk: `RL#ip-auth#abc#${start}`,
      n: 2,
      expires_at: (start + 6 * MIN) / 1000,
    });
    // The next window is a new item that starts at 1.
    expect(await counter.incr('RL#ip-auth#abc', start + 5 * MIN, 5 * MIN + COUNTER_GRACE_MS)).toBe(1);
  });

  it('T-WAUTH-5 hit() over the DynamoDB adapter refuses the 6th failure and starts over at the window edge', async () => {
    const table = new FakeCounterTable();
    const clock = new MemoryClock(T0 + 14 * MIN);
    const limits = createLimits({
      counter: new DynamoCounter({ client: table, tableName: 'sessions-test' }),
      clock,
      secretStore: new MemorySecretStore(),
      settings: prodSettings,
    });
    const fail = { email: EMAIL, ip: IP };
    expect((await hitTimes(5, () => limits.hit('auth-fail', fail))).every((r) => r.ok)).toBe(true);
    expect(await limits.hit('auth-fail', fail)).toEqual({ ok: false, retryAfterSeconds: 60 });
    clock.set(T0 + 15 * MIN);
    expect(await limits.hit('auth-fail', fail)).toEqual({ ok: true, retryAfterSeconds: 0 });
    for (const pk of table.items.keys()) {
      expect(pk).toMatch(/^RL#auth-fail#[A-Za-z0-9_-]{43}#\d+$/);
      expect(pk).not.toContain('example');
      expect(pk).not.toContain('192.0.2');
    }
  });

  it('T-WAUTH-5 a service error is thrown, never read as a count of zero', async () => {
    const table = new FakeCounterTable();
    table.failNext = 'ProvisionedThroughputExceededException';
    const counter = new DynamoCounter({ client: table, tableName: 'sessions-test' });
    await expect(counter.incr('RL#person#abc', T0, 2 * MIN)).rejects.toThrow('fake service error');
  });
});
