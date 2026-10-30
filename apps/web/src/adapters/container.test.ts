import { readdirSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContainer, PORT_NAMES } from './container';
import { MemoryAccountStore } from './memory/account-store';
import { MemoryBreachChecker } from './memory/breach-checker';
import { MemoryClock } from './memory/clock';
import { MemoryCounter } from './memory/counter';
import { MemoryDataApi } from './memory/data-api';
import { MemoryIdentityProvider } from './memory/identity-provider';
import { MemoryLogger } from './memory/logger';
import { MemoryParameterStore } from './memory/parameter-store';
import { MemoryPowStore } from './memory/pow-store';
import { MemoryPreAuthStore } from './memory/pre-auth-store';
import { MemorySecretStore } from './memory/secret-store';
import { MemorySessionStore } from './memory/session-store';
import { MemorySettings } from './memory/settings';

afterEach(() => vi.unstubAllEnvs());

const MEMORY = {
  clock: MemoryClock,
  settings: MemorySettings,
  secretStore: MemorySecretStore,
  parameterStore: MemoryParameterStore,
  logger: MemoryLogger,
  sessionStore: MemorySessionStore,
  preAuthStore: MemoryPreAuthStore,
  counter: MemoryCounter,
  powStore: MemoryPowStore,
  accountStore: MemoryAccountStore,
  breachChecker: MemoryBreachChecker,
  identityProvider: MemoryIdentityProvider,
  dataApi: MemoryDataApi,
};

const MIN = 60_000;

function testContainer() {
  vi.stubEnv('STAGE', 'test');
  return createContainer();
}

describe('T-WEB-14: the container', () => {
  it('T-WEB-14: under STAGE=test it returns one memory adapter per port', () => {
    const c = testContainer();
    expect(Object.keys(c).sort()).toEqual([...PORT_NAMES].sort());
    for (const [name, Adapter] of Object.entries(MEMORY)) expect(c[name as keyof typeof c], name).toBeInstanceOf(Adapter);
  });

  it('T-WEB-14: every port in architecture.md Contracts "Ports" has one interface file and one memory adapter', () => {
    const files = (dir: string) => readdirSync(new URL(dir, import.meta.url)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(PORT_NAMES).toHaveLength(13);
    expect(files('../ports/')).toHaveLength(13);
    expect(files('./memory/')).toHaveLength(13);
  });

  it('T-WEB-14: the adapters share one controllable clock', async () => {
    const c = testContainer();
    const clock = c.clock as MemoryClock;
    clock.set(1_000);
    await c.powStore.claim('salt', 10 * MIN);
    clock.advance(10 * MIN);
    expect(await c.powStore.claim('salt', 10 * MIN)).toBe(true);
  });

  it('T-WEB-14: each call builds fresh adapters, so tests do not share state', async () => {
    const a = testContainer();
    await a.powStore.claim('salt', MIN);
    expect(await testContainer().powStore.claim('salt', MIN)).toBe(true);
  });

  it('T-WEB-14: outside STAGE=test it refuses until the real adapters arrive', () => {
    for (const stage of ['qa', 'prod', '']) {
      vi.stubEnv('STAGE', stage);
      expect(() => createContainer(), stage).toThrow(/real adapters/);
    }
  });
});

describe('T-WEB-14: memory adapters keep the port rules', () => {
  it('T-WEB-14: sessions expire with the clock, touch only updates an existing row, and delete by person', async () => {
    const c = testContainer();
    const clock = c.clock as MemoryClock;
    clock.set(0);
    const row = { idHash: 'h1', sub: 's1', accessToken: 'a', idToken: 'i', refreshToken: 'r', createdAt: 0, lastSeenAt: 0, expiresAt: 12 * 60 * MIN };
    await c.sessionStore.create(row);
    await c.sessionStore.create({ ...row, idHash: 'h2' });
    await c.sessionStore.create({ ...row, idHash: 'h3', sub: 's2' });
    expect(await c.sessionStore.touch('h1', 5 * MIN)).toBe(true);
    expect((await c.sessionStore.get('h1'))?.lastSeenAt).toBe(5 * MIN);
    expect(await c.sessionStore.touch('missing', 5 * MIN)).toBe(false);
    expect((await c.sessionStore.listBySub('s1')).map((r) => r.idHash).sort()).toEqual(['h1', 'h2']);
    expect(await c.sessionStore.deleteBySub('s1')).toBe(2);
    expect(await c.sessionStore.get('h1')).toBeUndefined();
    clock.set(12 * 60 * MIN);
    expect(await c.sessionStore.get('h3')).toBeUndefined();
    expect(await c.sessionStore.touch('h3', clock.now())).toBe(false);
  });

  it('T-WEB-14: pre-auth rows update only while they exist', async () => {
    const c = testContainer();
    (c.clock as MemoryClock).set(0);
    await c.preAuthStore.create({
      idHash: 'p',
      step: 'confirm',
      email: 'a@example.test',
      emailHash: 'eh',
      lang: 'en',
      attempts: 0,
      expiresAt: 15 * MIN,
    });
    expect(await c.preAuthStore.update('p', { attempts: 1 })).toBe(true);
    expect((await c.preAuthStore.get('p'))?.attempts).toBe(1);
    expect(await c.preAuthStore.update('nope', { attempts: 1 })).toBe(false);
    await c.preAuthStore.delete('p');
    expect(await c.preAuthStore.get('p')).toBeUndefined();
  });

  it('T-WEB-14: counters count per key and window, and restart after the ttl', async () => {
    const c = testContainer();
    const clock = c.clock as MemoryClock;
    clock.set(0);
    expect(await c.counter.incr('ip#1', 0, 6 * MIN)).toBe(1);
    expect(await c.counter.incr('ip#1', 0, 6 * MIN)).toBe(2);
    expect(await c.counter.incr('ip#1', 5 * MIN, 6 * MIN)).toBe(1);
    expect(await c.counter.incr('ip#2', 0, 6 * MIN)).toBe(1);
    clock.advance(6 * MIN);
    expect(await c.counter.incr('ip#1', 0, 6 * MIN)).toBe(1);
  });

  it('T-WEB-14: a proof-of-work salt is claimed once', async () => {
    const c = testContainer();
    expect(await c.powStore.claim('salt', 10 * MIN)).toBe(true);
    expect(await c.powStore.claim('salt', 10 * MIN)).toBe(false);
  });

  it('T-WEB-14: the account store reserves imports conditionally: daily, stored bytes, one running', async () => {
    const c = testContainer();
    const day = '2026-10-30';
    const MiB = 1024 * 1024;
    expect(await c.accountStore.getAccount('s')).toBeUndefined();
    await c.accountStore.putConsent('s', { termsVersion: '2026-11-01', privacyVersion: '2026-11-01', lang: 'es', acceptedAt: 1 });
    expect((await c.accountStore.getAccount('s'))?.status).toBe('active');
    expect(await c.accountStore.reserveImport('s', { day, bytes: MiB, importId: 'i1' })).toEqual({ ok: true });
    expect(await c.accountStore.reserveImport('s', { day, bytes: MiB, importId: 'i2' })).toEqual({ ok: false, reason: 'running' });
    await c.accountStore.releaseImport('s', 'i1', 2 * MiB);
    expect((await c.accountStore.getAccount('s'))?.storedBytes).toBe(2 * MiB);
    expect(await c.accountStore.reserveImport('s', { day, bytes: 199 * MiB, importId: 'i3' })).toEqual({ ok: false, reason: 'bytes' });
    for (let i = 0; i < 9; i++) {
      expect(await c.accountStore.reserveImport('s', { day, bytes: 1, importId: `d${i}` })).toEqual({ ok: true });
      await c.accountStore.releaseImport('s', `d${i}`, 1);
    }
    expect(await c.accountStore.reserveImport('s', { day, bytes: 1, importId: 'd10' })).toEqual({ ok: false, reason: 'daily' });
    expect(await c.accountStore.reserveImport('s', { day: '2026-10-31', bytes: 1, importId: 'n1' })).toEqual({ ok: true });
    await c.accountStore.resetStoredBytes('s');
    expect((await c.accountStore.getAccount('s'))?.storedBytes).toBe(0);
    await c.accountStore.markDeleting('s', 5);
    expect(await c.accountStore.getAccount('s')).toMatchObject({ status: 'deleting', deletingSince: 5 });
    await c.accountStore.deleteAccountRow('s');
    expect(await c.accountStore.getAccount('s')).toBeUndefined();
  });

  it('T-WEB-14: the identity fake signs up, confirms with 123456 and signs in through authenticator setup and code 000000', async () => {
    const c = testContainer();
    const idp = c.identityProvider;
    const email = 'person@example.test';
    expect(await idp.signUp(email, 'a long enough password', 'en')).toEqual({ ok: true });
    expect(await idp.signUp(email, 'a long enough password', 'en')).toEqual({ ok: false, reason: 'exists' });
    expect(await idp.passwordAuth(email, 'a long enough password')).toEqual({ ok: false, reason: 'unconfirmed' });
    expect(await idp.confirm(email, '111111')).toEqual({ ok: false, reason: 'bad_code' });
    expect(await idp.confirm(email, '123456')).toEqual({ ok: true });
    expect(await idp.passwordAuth(email, 'wrong')).toEqual({ ok: false, reason: 'bad_credentials' });
    const first = await idp.passwordAuth(email, 'a long enough password');
    if (!first.ok || !('challenge' in first)) throw new Error('expected a challenge');
    expect(first.challenge).toBe('MFA_SETUP');
    const assoc = await idp.associate(first.session);
    if (!assoc.ok) throw new Error('associate failed');
    expect(assoc.secret).toMatch(/^[A-Z2-7]+$/);
    expect(await idp.verifySetup(assoc.session, '000000')).toEqual({ ok: true });
    const second = await idp.passwordAuth(email, 'a long enough password');
    if (!second.ok || !('challenge' in second)) throw new Error('expected a challenge');
    expect(second.challenge).toBe('SOFTWARE_TOKEN_MFA');
    expect(await idp.respondCode(email, second.session, '999999')).toEqual({ ok: false, reason: 'bad_code' });
    const signedIn = await idp.respondCode(email, second.session, '000000');
    if (!signedIn.ok) throw new Error('code failed');
    const user = await idp.adminGet(email);
    if (!user.ok) throw new Error('adminGet failed');
    const refreshed = await idp.refresh(user.sub, signedIn.tokens.refresh);
    expect(refreshed.ok).toBe(true);
    await idp.adminGlobalSignOut(user.sub);
    expect(await idp.refresh(user.sub, signedIn.tokens.refresh)).toEqual({ ok: false, reason: 'revoked' });
  });

  it('T-WEB-14: the identity fake resets a password with the email code', async () => {
    const c = testContainer();
    const idp = c.identityProvider;
    await idp.signUp('r@example.test', 'first password here', 'es');
    await idp.confirm('r@example.test', '123456');
    expect(await idp.forgot('r@example.test', 'es')).toEqual({ ok: true });
    expect(await idp.confirmForgot('r@example.test', '123456', 'second password here')).toEqual({ ok: true });
    expect(await idp.passwordAuth('r@example.test', 'first password here')).toEqual({ ok: false, reason: 'bad_credentials' });
    expect((await idp.passwordAuth('r@example.test', 'second password here')).ok).toBe(true);
    const user = await idp.adminGet('r@example.test');
    if (!user.ok) throw new Error('adminGet failed');
    await idp.adminDelete(user.sub);
    expect(await idp.adminGet('r@example.test')).toEqual({ ok: false, reason: 'not_found' });
  });

  it('T-WEB-14: the data API fake answers only a known token and pages transactions', async () => {
    const c = testContainer();
    const api = c.dataApi as MemoryDataApi;
    api.allowToken('tok');
    const tx = (id: string, date: string, amount: number) => ({
      id,
      date,
      date_precision: 'day' as const,
      kind: 'expense',
      amount,
      currency: 'ARS',
      category: 'Groceries',
      merchant: 'Shop',
      description_raw: 'SHOP',
      source: 'mercadopago',
      source_ref: id,
      import_batch: 'b1',
      country: 'AR',
      flags: [],
      review: { reasons: [], approved: false },
    });
    api.seed({ transactions: [tx('a', '2026-05-02', -100), tx('b', '2026-05-09', -300), tx('c', '2026-06-01', -200)] });
    expect(await api.listTransactions('other', { from: '2026-05', to: '2026-05' })).toEqual({ ok: false, kind: 'unauthorized' });
    const page1 = await api.listTransactions('tok', { from: '2026-05', to: '2026-06', limit: 2 });
    if (!page1.ok) throw new Error('list failed');
    expect(page1.data.items.map((t) => t.id)).toEqual(['c', 'b']);
    const page2 = await api.listTransactions('tok', { from: '2026-05', to: '2026-06', limit: 2, cursor: page1.data.cursor });
    if (!page2.ok) throw new Error('list failed');
    expect(page2.data.items.map((t) => t.id)).toEqual(['a']);
    expect(page2.data.cursor).toBeUndefined();
    expect(await api.listTransactions('tok', { from: '2026-07', to: '2026-05' })).toMatchObject({ ok: false, kind: 'failed', code: 'bad_request' });
    expect(await api.putRate('tok', { month: '2026-05', ars_per_usd: 1321.07 })).toEqual({
      ok: true,
      data: { month: '2026-05', ars_per_usd: 1321.07 },
    });
    expect(await c.dataApi.rates('tok', {})).toEqual({ ok: true, data: { items: [{ month: '2026-05', ars_per_usd: 1321.07 }] } });
    expect(await api.erase('tok', { confirm: 'DELETE' })).toEqual({ ok: true, data: { deleted: { items: 3, files: 0 } } });
  });

  it('T-WEB-14: the breach checker, secrets, parameters and logger fakes', async () => {
    const c = testContainer();
    const breach = c.breachChecker as MemoryBreachChecker;
    breach.add('password1234');
    expect(await c.breachChecker.isBreached('password1234')).toBe(true);
    expect(await c.breachChecker.isBreached('a fresh password')).toBe(false);
    breach.setUnavailable(true);
    expect(await c.breachChecker.isBreached('a fresh password')).toBe('unavailable');
    (c.secretStore as MemorySecretStore).set('arn:test', 'secret');
    expect(await c.secretStore.get('arn:test')).toBe('secret');
    await expect(c.secretStore.get('arn:missing')).rejects.toThrow();
    (c.parameterStore as MemoryParameterStore).set('/smart-finances/test/imports-paused', 'false');
    expect(await c.parameterStore.get('/smart-finances/test/imports-paused')).toBe('false');
    expect(await c.parameterStore.get('/smart-finances/test/missing')).toBeUndefined();
    c.logger.event('sign_in', 'ok', { requestId: 'r1' });
    expect((c.logger as MemoryLogger).events).toEqual([{ name: 'sign_in', outcome: 'ok', sub: undefined, requestId: 'r1' }]);
    expect(c.settings.get().STAGE).toBe('test');
  });
});
