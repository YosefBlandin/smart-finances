import { createHash, createHmac, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { memoryContainer, type Container } from '@/adapters/container';
import type { MemoryClock } from '@/adapters/memory/clock';
import type { MemoryLogger } from '@/adapters/memory/logger';
import { TEST_SETTINGS } from '@/adapters/memory/settings';
import { createGuarded, guarded, type ActionResult } from './guarded';

// T-WAUTH-7 (D-115, D-124, D-125, D-153): every auth server action goes through guarded(): the exact Origin, then the
// proof of work, then the window counters, then the Zod input; it answers { ok, data } or { ok: false, messageKey }
// and never throws to the client.

const { headerStore } = vi.hoisted(() => ({ headerStore: { current: new Headers() } }));
vi.mock('next/headers', () => ({ headers: async () => headerStore.current }));

const ORIGIN = TEST_SETTINGS.WEB_ORIGIN;
const HMAC = 'test-hmac-secret';
const schema = z.object({ email: z.string().email(), lang: z.enum(['en', 'es']) });
const GOOD = { email: 'person@example.test', lang: 'en' };

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** A valid answer, signed as /api/auth/pow signs one (application/pow.ts), without solving the puzzle. */
function answer(now: number, n = '0') {
  const salt = `${randomBytes(16).toString('base64url')}.${now + 10 * 60_000}`;
  const sig = createHmac('sha256', HMAC)
    .update(`pow:${sha256(salt + n)}`)
    .digest('hex');
  return { powSalt: salt, powN: n, powSig: sig };
}

function req(h: Record<string, string>) {
  return async () => new Headers(h);
}

function setup(h: Record<string, string> = { origin: ORIGIN, 'x-forwarded-for': '198.51.100.7' }) {
  const container = memoryContainer();
  const headers = { current: h };
  const g = createGuarded({ headers: () => req(headers.current)(), container: () => container });
  const calls: unknown[] = [];
  const action = g(schema, { kind: 'auth' }, async (input) => {
    calls.push(input);
    return { ok: true, data: { echoed: input.email } };
  });
  const post = (fields: Record<string, string> = { ...GOOD, ...answer(container.clock.now()) }) => action(fields);
  return { container, headers, action, post, calls, g };
}

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};

afterEach(() => {
  vi.unstubAllEnvs();
  headerStore.current = new Headers();
});

describe('T-WAUTH-7: the exact Origin', () => {
  it('T-WAUTH-7: a post with the stage origin, a valid answer and valid input runs the action with the parsed input', async () => {
    const { post, calls } = setup();
    expect(await post()).toEqual({ ok: true, data: { echoed: 'person@example.test' } });
    expect(calls).toEqual([GOOD]);
  });

  it('T-WAUTH-7: a missing Origin gets auth.forbidden and the action never runs', async () => {
    const { post, headers, calls } = setup();
    headers.current = { 'x-forwarded-for': '198.51.100.7' };
    expect(await post()).toEqual({ ok: false, messageKey: 'auth.forbidden' });
    expect(calls).toEqual([]);
  });

  it('T-WAUTH-7: Origin null (an opaque or no-referrer post) gets auth.forbidden', async () => {
    const { post, headers, calls } = setup();
    for (const origin of ['null', 'NULL', '']) {
      headers.current = { origin };
      expect(await post(), origin).toEqual({ ok: false, messageKey: 'auth.forbidden' });
    }
    expect(calls).toEqual([]);
  });

  it('T-WAUTH-7: a foreign or lookalike Origin gets auth.forbidden', async () => {
    const { post, headers, calls } = setup();
    for (const origin of [
      'https://evil.example.test',
      `${ORIGIN}/`,
      `${ORIGIN}.evil.example.test`,
      ORIGIN.replace('http:', 'https:'),
      ORIGIN.toUpperCase(),
      `${ORIGIN}, ${ORIGIN}`,
      'http://localhost:3001',
    ]) {
      headers.current = { origin };
      expect(await post(), origin).toEqual({ ok: false, messageKey: 'auth.forbidden' });
    }
    expect(calls).toEqual([]);
  });

  it('T-WAUTH-7: the Origin is checked against WEB_ORIGIN from the settings, not a fixed value', async () => {
    const container = memoryContainer({ get: () => ({ ...TEST_SETTINGS, WEB_ORIGIN: 'https://qa.example.test' }) });
    const g = createGuarded({ headers: req({ origin: 'https://qa.example.test' }), container: () => container });
    const action = g(schema, { kind: 'auth' }, async (input) => ({ ok: true, data: input.lang }));
    expect(await action({ ...GOOD, ...answer(container.clock.now()) })).toEqual({ ok: true, data: 'en' });
    const local = createGuarded({ headers: req({ origin: ORIGIN }), container: () => container });
    expect(await local(schema, { kind: 'auth' }, async () => ({ ok: true, data: 1 }))({ ...GOOD, ...answer(container.clock.now()) })).toEqual({
      ok: false,
      messageKey: 'auth.forbidden',
    });
  });

  it('T-WAUTH-7: a refused Origin is checked before the proof of work, so it uses up no answer', async () => {
    const { post, headers, container } = setup();
    const fields = { ...GOOD, ...answer(container.clock.now()) };
    headers.current = { origin: 'https://evil.example.test' };
    expect(await post(fields)).toEqual({ ok: false, messageKey: 'auth.forbidden' });
    headers.current = { origin: ORIGIN };
    expect((await post(fields)).ok).toBe(true);
  });
});

describe('T-WAUTH-7: the proof of work', () => {
  it('T-WAUTH-7: an auth action without a proof-of-work answer is refused', async () => {
    const { post, calls } = setup();
    expect(await post({ ...GOOD })).toEqual({ ok: false, messageKey: 'auth.proofFailed' });
    expect(calls).toEqual([]);
  });

  it('T-WAUTH-7: a wrong, malformed, expired or reused answer is refused', async () => {
    const { post, calls, container } = setup();
    const now = container.clock.now();
    const good = answer(now);
    const cases: Record<string, string>[] = [
      { ...answer(now), powSig: 'f'.repeat(64) },
      { ...answer(now), powN: 'abc' },
      { ...answer(now - 11 * 60_000) },
    ];
    for (const a of cases) expect(await post({ ...GOOD, ...a }), JSON.stringify(a)).toEqual({ ok: false, messageKey: 'auth.proofFailed' });
    expect(calls).toEqual([]);
    expect((await post({ ...GOOD, ...good })).ok).toBe(true);
    expect(await post({ ...GOOD, ...good })).toEqual({ ok: false, messageKey: 'auth.proofFailed' });
    expect(calls).toHaveLength(1);
  });

  it('T-WAUTH-7: the answer fields never reach the action input', async () => {
    const container = memoryContainer();
    const g = createGuarded({ headers: req({ origin: ORIGIN }), container: () => container });
    const seen: unknown[] = [];
    const action = g(z.object({ email: z.string() }).strict(), { kind: 'auth' }, async (input) => {
      seen.push(input);
      return { ok: true, data: null };
    });
    expect(await action({ email: 'person@example.test', ...answer(container.clock.now()) })).toEqual({ ok: true, data: null });
    expect(seen).toEqual([{ email: 'person@example.test' }]);
  });
});

describe('T-WAUTH-7: the window counters', () => {
  it('T-WAUTH-7: the 21st auth post from one address prefix in 5 minutes gets auth.limited with the wait; others are not slowed', async () => {
    const { post, headers, container, calls } = setup();
    const clock = container.clock as MemoryClock;
    clock.set(Math.floor(clock.now() / 300_000) * 300_000 + 60_000);
    for (let i = 0; i < 20; i++) {
      // Left X-Forwarded-For entries are whatever the client sent; only the right-most counts.
      headers.current = { origin: ORIGIN, 'x-forwarded-for': `203.0.113.${i}, 198.51.100.${i}` };
      expect((await post()).ok, `post ${i + 1}`).toBe(true);
    }
    headers.current = { origin: ORIGIN, 'x-forwarded-for': '10.0.0.1, 198.51.100.200' };
    expect(await post()).toEqual({ ok: false, messageKey: 'auth.limited', retryAfterSeconds: 240 });
    expect(calls).toHaveLength(20);
    expect((container.logger as MemoryLogger).events.filter((e) => e.name === 'rate_limited')).toEqual([
      { name: 'rate_limited', outcome: 'ip-auth', sub: undefined, requestId: expect.any(String) },
    ]);

    headers.current = { origin: ORIGIN, 'x-forwarded-for': '198.51.101.1' };
    expect((await post()).ok).toBe(true);
    clock.advance(240_000);
    headers.current = { origin: ORIGIN, 'x-forwarded-for': '198.51.100.9' };
    expect((await post()).ok).toBe(true);
  });

  it('T-WAUTH-7: a refused answer is not counted, so a flood without proof of work cannot lock an address out', async () => {
    const { post } = setup();
    for (let i = 0; i < 25; i++) expect((await post({ ...GOOD })).ok).toBe(false);
    expect((await post()).ok).toBe(true);
  });
});

describe('T-WAUTH-7: the Zod input', () => {
  it('T-WAUTH-7: bad input becomes auth.invalid after the other checks, and the action never runs', async () => {
    const { post, calls, container } = setup();
    for (const bad of [{ email: 'not-an-email', lang: 'en' }, { email: 'person@example.test', lang: 'fr' }, {}]) {
      expect(await post({ ...(bad as Record<string, string>), ...answer(container.clock.now()) })).toEqual({ ok: false, messageKey: 'auth.invalid' });
    }
    expect(await post({ email: 'x' })).toEqual({ ok: false, messageKey: 'auth.proofFailed' });
    expect(calls).toEqual([]);
  });

  it('T-WAUTH-7: takes FormData, alone or after the previous state (useActionState), and drops Next.js action fields', async () => {
    const { action, calls, container } = setup();
    const fields = () => ({ ...GOOD, ...answer(container.clock.now()), $ACTION_REF_1: '', '$ACTION_1:0': '{}' });
    expect((await action(form(fields()))).ok).toBe(true);
    expect((await action({ ok: false, messageKey: 'auth.invalid' }, form(fields()))).ok).toBe(true);
    expect(calls).toEqual([GOOD, GOOD]);
  });

  it('T-WAUTH-7: input that is not a form or an object is refused, not thrown', async () => {
    const { action } = setup();
    for (const input of [undefined, null, 'email=person@example.test', 42]) {
      expect(await action(input), String(input)).toEqual({ ok: false, messageKey: 'auth.proofFailed' });
    }
  });
});

describe('T-WAUTH-7: never throws to the client', () => {
  it('T-WAUTH-7: a refusal from the action passes through unchanged', async () => {
    const container = memoryContainer();
    const g = createGuarded({ headers: req({ origin: ORIGIN }), container: () => container });
    const action = g(schema, { kind: 'auth' }, async (): Promise<ActionResult<never>> => ({
      ok: false,
      messageKey: 'auth.signIn.errWrong',
    }));
    expect(await action({ ...GOOD, ...answer(container.clock.now()) })).toEqual({ ok: false, messageKey: 'auth.signIn.errWrong' });
  });

  it('T-WAUTH-7: a thrown action, a broken container or a failing store becomes auth.unavailable', async () => {
    const container = memoryContainer();
    const g = createGuarded({ headers: req({ origin: ORIGIN }), container: () => container });
    const boom = g(schema, { kind: 'auth' }, async () => {
      throw new Error('the pool said no, with person@example.test in it');
    });
    expect(await boom({ ...GOOD, ...answer(container.clock.now()) })).toEqual({ ok: false, messageKey: 'auth.unavailable' });

    const noContainer = createGuarded({
      headers: req({ origin: ORIGIN }),
      container: () => {
        throw new Error('No real adapters yet');
      },
    });
    expect(await noContainer(schema, { kind: 'auth' }, async () => ({ ok: true, data: 1 }))(GOOD)).toEqual({
      ok: false,
      messageKey: 'auth.unavailable',
    });

    const failing: Container = { ...memoryContainer(), counter: { incr: async () => Promise.reject(new Error('throttled')) } };
    const g2 = createGuarded({ headers: req({ origin: ORIGIN }), container: () => failing });
    expect(await g2(schema, { kind: 'auth' }, async () => ({ ok: true, data: 1 }))({ ...GOOD, ...answer(failing.clock.now()) })).toEqual({
      ok: false,
      messageKey: 'auth.unavailable',
    });

    const noHeaders = createGuarded({ headers: () => Promise.reject(new Error('outside a request')), container: () => container });
    expect(await noHeaders(schema, { kind: 'auth' }, async () => ({ ok: true, data: 1 }))(GOOD)).toEqual({
      ok: false,
      messageKey: 'auth.unavailable',
    });
  });

  it('T-WAUTH-7: Next.js redirects thrown by the action still propagate (they are not errors)', async () => {
    const { redirect } = await import('next/navigation');
    const container = memoryContainer();
    const g = createGuarded({ headers: req({ origin: ORIGIN }), container: () => container });
    const action = g(schema, { kind: 'auth' }, async () => redirect('/sign-in/code'));
    await expect(action({ ...GOOD, ...answer(container.clock.now()) })).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });
  });
});

describe('T-WAUTH-7: guarded() itself, wired to next/headers and the shared container', () => {
  it('T-WAUTH-7: under STAGE=test it reads the request headers and keeps one container across posts', async () => {
    vi.stubEnv('STAGE', 'test');
    const action = guarded(schema, { kind: 'auth' }, async (input) => ({ ok: true, data: input.email }));
    const fields = { ...GOOD, ...answer(Date.now()) };
    headerStore.current = new Headers({ origin: ORIGIN, 'x-forwarded-for': '192.0.2.10' });
    expect(await action(form(fields))).toEqual({ ok: true, data: 'person@example.test' });
    // The same answer again is a replay: the claim from the first post is still held by the shared store.
    expect(await action(form(fields))).toEqual({ ok: false, messageKey: 'auth.proofFailed' });
    headerStore.current = new Headers({ 'x-forwarded-for': '192.0.2.10' });
    expect(await action(form({ ...GOOD, ...answer(Date.now()) }))).toEqual({ ok: false, messageKey: 'auth.forbidden' });
  });
});
