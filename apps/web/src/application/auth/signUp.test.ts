/* eslint-disable import/no-restricted-paths -- T-WAUTH-9 and T-WAUTH-10 drive the sign-up and confirm use cases over the
   memory adapters (the STAGE=test container), which is the task's one test file; no production application code
   imports adapters. */
import { describe, expect, it } from 'vitest';
import { memoryContainer, type Container } from '@/adapters/container';
import type { MemoryBreachChecker } from '@/adapters/memory/breach-checker';
import { MemoryClock } from '@/adapters/memory/clock';
import { TEST_EMAIL_CODE, type MemoryIdentityProvider } from '@/adapters/memory/identity-provider';
import type { MemoryLogger } from '@/adapters/memory/logger';
import { createSessions } from '@/application/session';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/legal/versions';
import { createConfirm } from './confirm';
import { createSignUp, REPLY_MS } from './signUp';

// T-WAUTH-9 (D-106), T-WAUTH-10 (D-75, D-106) and the logging half of T-WAUTH-8 (D-117, owner decision on the SF-146
// deviation): sign-up and confirm as use cases over the memory adapters. Synthetic addresses only.

const START = Date.UTC(2026, 10, 4, 10, 0, 0);
const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'another long pass phrase';
const VERSIONS = { terms: TERMS_VERSION, privacy: PRIVACY_VERSION };

/** A container whose identity calls each take `latency` ms of clock time, and whose sleep moves the clock. */
function setup(latency = 0) {
  const clock = new MemoryClock(START);
  const container: Container = memoryContainer(undefined, clock);
  const idp = container.identityProvider as MemoryIdentityProvider;
  const slow = new Proxy(idp, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        clock.advance(latency);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
    clock.advance(ms);
  };
  const deps = { ...container, identityProvider: slow, versions: VERSIONS, sleep };
  const signUp = createSignUp(deps);
  const { confirm, resend } = createConfirm(deps);
  const sessions = createSessions(container);
  const logger = container.logger as MemoryLogger;
  const breach = container.breachChecker as MemoryBreachChecker;
  return { clock, container, idp, signUp, confirm, resend, sessions, logger, breach, sleeps };
}

const ctx = (requestId = 'req-1', preAuthId?: string) => ({ requestId, preAuthId });

/** The time one call takes on the fake clock. */
async function timed<T>(clock: MemoryClock, run: () => Promise<T>) {
  const t0 = clock.now();
  const result = await run();
  return { result, ms: clock.now() - t0 };
}

describe('T-WAUTH-9: sign-up again with an unconfirmed email replaces it', () => {
  it('T-WAUTH-9: the second sign-up replaces the unconfirmed one, so only the new password works after confirm', async () => {
    const { signUp, confirm, idp } = setup();
    const first = await signUp({ email: 'Person@Example.test', password: PASSWORD, accepted: true, lang: 'en' }, ctx());
    expect(first.ok).toBe(true);
    const firstSub = await idp.adminGet('person@example.test');

    const second = await signUp({ email: 'person@example.test', password: NEW_PASSWORD, accepted: true, lang: 'es' }, ctx('req-2'));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const secondSub = await idp.adminGet('person@example.test');
    expect(secondSub.ok && firstSub.ok && secondSub.sub !== firstSub.sub).toBe(true);
    expect(secondSub.ok && secondSub.status).toBe('UNCONFIRMED');

    expect(await confirm({ code: TEST_EMAIL_CODE }, ctx('req-3', second.data.preAuthId))).toEqual({ ok: true, data: { next: '/sign-in' } });
    expect(await idp.passwordAuth('person@example.test', PASSWORD)).toEqual({ ok: false, reason: 'bad_credentials' });
    expect((await idp.passwordAuth('person@example.test', NEW_PASSWORD)).ok).toBe(true);
    // Two code emails: one per sign-up, the second in the language of the second.
    expect(idp.codeEmails).toEqual([
      { email: 'person@example.test', kind: 'signup', lang: 'en' },
      { email: 'person@example.test', kind: 'signup', lang: 'es' },
    ]);
  });

  it('T-WAUTH-9: the pre-auth row holds the step, the email, the accepted versions and the language; the old row goes', async () => {
    const { signUp, sessions } = setup();
    const first = await signUp({ email: 'person@example.test', password: PASSWORD, accepted: true, lang: 'es' }, ctx());
    if (!first.ok) throw new Error('sign-up refused');
    const row = await sessions.readPreAuth(first.data.preAuthId);
    expect(row).toMatchObject({ step: 'confirm', email: 'person@example.test', acceptedVersions: VERSIONS, lang: 'es', attempts: 0 });
    expect(row?.emailHash).toMatch(/^[0-9a-f]{64}$/);
    expect(VERSIONS).toEqual({ terms: '2026-11-01', privacy: '2026-11-01' });

    const second = await signUp(
      { email: 'person@example.test', password: NEW_PASSWORD, accepted: true, lang: 'en' },
      ctx('req-2', first.data.preAuthId),
    );
    if (!second.ok) throw new Error('sign-up refused');
    expect(await sessions.readPreAuth(first.data.preAuthId)).toBeNull();
    expect(await sessions.readPreAuth(second.data.preAuthId)).toMatchObject({ step: 'confirm', lang: 'en' });
  });

  it('T-WAUTH-9: without the accepted terms, or with a password under 12 or over 128 characters, nothing is created', async () => {
    const { signUp, idp } = setup();
    expect(await signUp({ email: 'person@example.test', password: PASSWORD, accepted: false, lang: 'en' }, ctx())).toEqual({
      ok: false,
      messageKey: 'auth.signUp.errAccept',
    });
    for (const password of ['short pass1', 'x'.repeat(129)]) {
      expect(await signUp({ email: 'person@example.test', password, accepted: true, lang: 'en' }, ctx())).toEqual({
        ok: false,
        messageKey: 'auth.signUp.errWeak',
      });
    }
    // 12 characters counted as characters, not UTF-16 units: eleven emoji are 11, not 22.
    expect((await signUp({ email: 'person@example.test', password: '🙂'.repeat(11), accepted: true, lang: 'en' }, ctx())).ok).toBe(false);
    expect(idp.codeEmails).toEqual([]);
  });
});

describe('T-WAUTH-10: known and unknown emails get the same reply and timing; code emails stop at the cap', () => {
  it('T-WAUTH-10: a confirmed email gets the same reply as a new one, in the same time, and no email', async () => {
    const { signUp, confirm, idp, clock, logger } = setup(150);
    const known = await signUp({ email: 'known@example.test', password: PASSWORD, accepted: true, lang: 'en' }, ctx());
    if (!known.ok) throw new Error('sign-up refused');
    await confirm({ code: TEST_EMAIL_CODE }, ctx('req-c', known.data.preAuthId));
    const emailsBefore = idp.codeEmails.length;

    const again = await timed(clock, () => signUp({ email: 'known@example.test', password: NEW_PASSWORD, accepted: true, lang: 'en' }, ctx('req-k')));
    const fresh = await timed(clock, () => signUp({ email: 'unknown@example.test', password: PASSWORD, accepted: true, lang: 'en' }, ctx('req-u')));

    expect(again.result.ok && fresh.result.ok).toBe(true);
    if (!again.result.ok || !fresh.result.ok) return;
    expect(Object.keys(again.result.data).sort()).toEqual(Object.keys(fresh.result.data).sort());
    expect(again.result.data.email).toBe('known@example.test');
    expect(again.ms).toBe(REPLY_MS);
    expect(fresh.ms).toBe(REPLY_MS);
    expect(REPLY_MS).toBe(800);
    // No email for the confirmed one, one for the new one; the old password still works.
    expect(idp.codeEmails.slice(emailsBefore)).toEqual([{ email: 'unknown@example.test', kind: 'signup', lang: 'en' }]);
    expect(await idp.passwordAuth('known@example.test', NEW_PASSWORD)).toEqual({ ok: false, reason: 'bad_credentials' });
    expect(logger.events.find((e) => e.requestId === 'req-k')).toMatchObject({ name: 'signup', outcome: 'exists' });
  });

  it('T-WAUTH-10: the confirm and resend replies for a confirmed or unknown email look like a wrong code or a sent one', async () => {
    const { signUp, confirm, resend, idp } = setup();
    const known = await signUp({ email: 'known@example.test', password: PASSWORD, accepted: true, lang: 'en' }, ctx());
    if (!known.ok) throw new Error('sign-up refused');
    await confirm({ code: TEST_EMAIL_CODE }, ctx('c', known.data.preAuthId));
    const again = await signUp({ email: 'known@example.test', password: PASSWORD, accepted: true, lang: 'en' }, ctx());
    if (!again.ok) throw new Error('sign-up refused');
    const before = idp.codeEmails.length;
    expect(await resend({}, ctx('r', again.data.preAuthId))).toEqual({ ok: true, data: { sent: true } });
    expect(idp.codeEmails.length).toBe(before);
    expect(await confirm({ code: '654321' }, ctx('c2', again.data.preAuthId))).toEqual({ ok: false, messageKey: 'auth.confirm.errWrong' });
  });

  it('T-WAUTH-10: a reply that takes longer than 800 ms is not padded further, and a refusal is padded too', async () => {
    const { signUp, clock } = setup(500);
    const slow = await timed(clock, () => signUp({ email: 'person@example.test', password: PASSWORD, accepted: true, lang: 'en' }, ctx()));
    expect(slow.result.ok).toBe(true);
    expect(slow.ms).toBeGreaterThan(REPLY_MS);
    const refused = await timed(clock, () => signUp({ email: 'person@example.test', password: 'short', accepted: true, lang: 'en' }, ctx()));
    expect(refused.result.ok).toBe(false);
    expect(refused.ms).toBe(REPLY_MS);
  });

  it('T-WAUTH-10: code emails stop at 3 an hour, with the same reply and a rate_limited event', async () => {
    const { signUp, resend, idp, logger } = setup();
    const replies = [];
    for (let i = 0; i < 4; i++) {
      replies.push(await signUp({ email: 'person@example.test', password: PASSWORD, accepted: true, lang: 'en' }, ctx(`req-${i}`)));
    }
    expect(replies.every((r) => r.ok)).toBe(true);
    expect(idp.codeEmails).toHaveLength(3);
    const last = replies[3]!;
    if (!last.ok) return;
    expect(await resend({}, ctx('req-r', last.data.preAuthId))).toEqual({ ok: true, data: { sent: true } });
    expect(idp.codeEmails).toHaveLength(3);
    expect(logger.events.filter((e) => e.name === 'rate_limited' && e.outcome === 'code-email').map((e) => e.requestId)).toEqual(['req-3', 'req-r']);
  });

  it('T-WAUTH-10: code emails stop at 10 a day across hours, and another email has its own count', async () => {
    const { signUp, resend, idp, clock } = setup();
    const first = await signUp({ email: 'person@example.test', password: PASSWORD, accepted: true, lang: 'en' }, ctx());
    if (!first.ok) throw new Error('sign-up refused');
    let id = first.data.preAuthId;
    for (let i = 0; i < 11; i++) {
      // Two resends an hour stay under the hourly cap; the day cap stops the 10th onward.
      await resend({}, ctx(`r${i}`, id));
      if (i % 2 === 1) {
        clock.advance(60 * 60_000);
        const next = await signUp({ email: 'person@example.test', password: PASSWORD, accepted: true, lang: 'en' }, ctx(`s${i}`, id));
        if (!next.ok) throw new Error('sign-up refused');
        id = next.data.preAuthId;
      }
    }
    expect(idp.codeEmails.filter((e) => e.email === 'person@example.test')).toHaveLength(10);
    expect(clock.now() - START).toBeLessThan(24 * 60 * 60_000);
    await signUp({ email: 'other@example.test', password: PASSWORD, accepted: true, lang: 'en' }, ctx());
    expect(idp.codeEmails.filter((e) => e.email === 'other@example.test')).toHaveLength(1);
  });

  it('T-WAUTH-10: a wrong code says so, 5 wrong codes end the step, an expired pre-auth row starts again', async () => {
    const { signUp, confirm, clock, logger } = setup();
    const r = await signUp({ email: 'person@example.test', password: PASSWORD, accepted: true, lang: 'en' }, ctx());
    if (!r.ok) throw new Error('sign-up refused');
    for (let i = 0; i < 4; i++) {
      expect(await confirm({ code: '111111' }, ctx(`w${i}`, r.data.preAuthId))).toEqual({ ok: false, messageKey: 'auth.confirm.errWrong' });
    }
    expect(await confirm({ code: '111111' }, ctx('w4', r.data.preAuthId))).toEqual({ ok: false, messageKey: 'auth.confirm.errLocked' });
    expect(await confirm({ code: TEST_EMAIL_CODE }, ctx('w5', r.data.preAuthId))).toEqual({ ok: false, messageKey: 'auth.confirm.errStart' });
    expect(logger.events.find((e) => e.requestId === 'w4')).toMatchObject({ name: 'signup_confirm', outcome: 'locked' });

    const again = await signUp({ email: 'person@example.test', password: PASSWORD, accepted: true, lang: 'en' }, ctx());
    if (!again.ok) throw new Error('sign-up refused');
    clock.advance(15 * 60_000 + 1);
    expect(await confirm({ code: TEST_EMAIL_CODE }, ctx('late', again.data.preAuthId))).toEqual({ ok: false, messageKey: 'auth.confirm.errStart' });
    expect(await confirm({ code: TEST_EMAIL_CODE }, ctx('none', undefined))).toEqual({ ok: false, messageKey: 'auth.confirm.errStart' });
  });

  it('T-WAUTH-10: the right code confirms, logs signup_confirm and moves the pre-auth row on with its versions', async () => {
    const { signUp, confirm, sessions, logger } = setup();
    const r = await signUp({ email: 'person@example.test', password: PASSWORD, accepted: true, lang: 'en' }, ctx());
    if (!r.ok) throw new Error('sign-up refused');
    expect(await confirm({ code: TEST_EMAIL_CODE }, ctx('ok', r.data.preAuthId))).toEqual({ ok: true, data: { next: '/sign-in' } });
    expect(await sessions.readPreAuth(r.data.preAuthId)).toMatchObject({ step: 'confirmed', acceptedVersions: VERSIONS });
    expect(logger.events.find((e) => e.requestId === 'ok')).toMatchObject({ name: 'signup_confirm', outcome: 'ok' });
  });
});

describe('T-WAUTH-8: the breach check in sign-up (logging half)', () => {
  it('T-WAUTH-8: when the checker answers unavailable, the password is accepted and breach_check_unavailable is logged once with the request id', async () => {
    const { signUp, breach, idp, logger } = setup();
    breach.setUnavailable(true);
    const r = await signUp({ email: 'person@example.test', password: PASSWORD, accepted: true, lang: 'en' }, ctx('req-breach'));
    expect(r.ok).toBe(true);
    expect(idp.codeEmails).toHaveLength(1);
    expect(logger.events.filter((e) => e.name === 'breach_check_unavailable')).toEqual([
      { name: 'breach_check_unavailable', outcome: 'unavailable', sub: undefined, requestId: 'req-breach' },
    ]);
  });

  it('T-WAUTH-8: a breached password is refused with errWeak, logged as breached_password, and nothing is created', async () => {
    const { signUp, breach, idp, logger } = setup();
    breach.add(PASSWORD);
    expect(await signUp({ email: 'person@example.test', password: PASSWORD, accepted: true, lang: 'en' }, ctx('req-b'))).toEqual({
      ok: false,
      messageKey: 'auth.signUp.errWeak',
    });
    expect(idp.codeEmails).toEqual([]);
    expect(await idp.adminGet('person@example.test')).toEqual({ ok: false, reason: 'not_found' });
    expect(logger.events).toEqual([{ name: 'breached_password', outcome: 'refused', sub: undefined, requestId: 'req-b' }]);
  });

  it('T-WAUTH-8: an available check that finds nothing logs no breach event', async () => {
    const { signUp, logger } = setup();
    await signUp({ email: 'person@example.test', password: PASSWORD, accepted: true, lang: 'en' }, ctx());
    expect(logger.events.map((e) => e.name)).toEqual(['signup']);
  });
});
