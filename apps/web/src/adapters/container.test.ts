import { readdirSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContainer, getContainer, PORT_NAMES } from './container';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProvider } from './cognito';
import { UnwiredParameterStore } from './container';
import { HttpDataApi } from './data-api';
import { DynamoAccountStore } from './dynamodb/accounts';
import { DynamoCounter } from './dynamodb/counters';
import { DynamoPowStore } from './dynamodb/pow';
import { DynamoPreAuthStore, DynamoSessionStore } from './dynamodb/sessions';
import { EnvSettings } from './env-settings';
import { JsonLogger } from './log';
import { MemoryAccountStore } from './memory/account-store';
import { MemoryBreachChecker } from './memory/breach-checker';
import { MemoryClock, SystemClock } from './memory/clock';
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
import { PwnedPasswordsChecker } from './pwned';
import { SecretsManagerStore } from './secrets';

const SHARED = Symbol.for('smart-finances.container');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete (globalThis as { [SHARED]?: unknown })[SHARED];
});

// architecture.md Contracts "Web server settings": synthetic qa values (no real pool, account or address).
const QA_ENV = {
  STAGE: 'qa',
  API_URL: 'https://api.qa.example.test',
  USER_POOL_ID: 'us-east-1_Example0',
  WEB_CLIENT_ID: 'example-web-client-0000',
  WEB_CLIENT_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:qa/web-client-secret',
  HMAC_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:qa/hmac-secret',
  SESSIONS_TABLE: 'sessions-qa-example',
  ACCOUNTS_TABLE: 'accounts-qa-example',
  UPLOAD_HOST: 'uploads.qa.example.test',
  WEB_ORIGIN: 'https://qa.example.test',
  SUPPORT_ADDRESS: 'support@example.test',
  COMMIT_SHA: 'example0sha',
} as const;
const SETTING_NAMES = Object.keys(QA_ENV) as (keyof typeof QA_ENV)[];

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

  // Updated by SF-154 (D-157): outside STAGE=test the container now builds the real adapters, so an environment
  // without the settings is refused for those settings, no longer for missing adapters.
  it('T-WEB-14: outside STAGE=test it refuses an environment without the web server settings', () => {
    for (const stage of ['qa', 'prod', '']) {
      vi.stubEnv('STAGE', stage);
      for (const name of SETTING_NAMES.filter((n) => n !== 'STAGE')) vi.stubEnv(name, '');
      expect(() => createContainer(), stage).toThrow(/Web server settings missing or invalid: .*USER_POOL_ID/);
    }
  });

  // Conformance fix (SF-154): the memory container's fixed codes and seeded test person must never serve a deployed
  // stage, so STAGE=test is refused where an AWS runtime says the process is deployed.
  it('T-WEB-14: STAGE=test is refused inside an AWS runtime, by createContainer and getContainer', () => {
    for (const marker of ['AWS_EXECUTION_ENV', 'AWS_LAMBDA_FUNCTION_NAME']) {
      vi.unstubAllEnvs();
      vi.stubEnv('STAGE', 'test');
      vi.stubEnv(marker, 'set-by-the-runtime');
      expect(() => createContainer(), marker).toThrow(/STAGE=test is refused in a deployed runtime/);
      expect(() => getContainer(), marker).toThrow(/STAGE=test is refused in a deployed runtime/);
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
    const setUp = await idp.verifySetup(email, assoc.session, '000000');
    expect(setUp.ok && 'tokens' in setUp).toBe(true);
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

// SF-154: outside STAGE=test the container builds the real adapters from the settings (D-138, D-159). Nothing here may
// reach the network: SDK clients are only constructed, and every send and fetch is spied on and must stay unused.
describe('T-WAUTH-19: the real container', () => {
  const REAL = {
    clock: SystemClock,
    settings: EnvSettings,
    secretStore: SecretsManagerStore,
    parameterStore: UnwiredParameterStore,
    logger: JsonLogger,
    sessionStore: DynamoSessionStore,
    preAuthStore: DynamoPreAuthStore,
    counter: DynamoCounter,
    powStore: DynamoPowStore,
    accountStore: DynamoAccountStore,
    breachChecker: PwnedPasswordsChecker,
    identityProvider: CognitoIdentityProvider,
    dataApi: HttpDataApi,
  };

  type Internals = { client?: { config: { region: () => Promise<string> } }; table?: string };
  const inner = (adapter: unknown) => adapter as Internals;

  function stubQa(overrides: Partial<Record<keyof typeof QA_ENV | 'AWS_REGION', string>> = {}) {
    for (const [name, value] of Object.entries({ ...QA_ENV, AWS_REGION: '', ...overrides })) vi.stubEnv(name, value);
  }

  function noNetwork() {
    const sends = [CognitoIdentityProviderClient, DynamoDBClient, DynamoDBDocumentClient, SecretsManagerClient].map((C) =>
      vi.spyOn(C.prototype, 'send').mockImplementation(() => {
        throw new Error('no AWS call in a unit test');
      }),
    );
    const fetch = vi.fn(() => Promise.reject(new Error('no network in a unit test')));
    vi.stubGlobal('fetch', fetch);
    return [...sends, fetch];
  }

  afterEach(() => vi.unstubAllGlobals());

  it('T-WAUTH-19: with STAGE=qa and complete settings it returns the real adapter of each port, without a network call', () => {
    const calls = noNetwork();
    stubQa();
    const c = createContainer();
    expect(Object.keys(c).sort()).toEqual([...PORT_NAMES].sort());
    for (const [name, Adapter] of Object.entries(REAL)) expect(c[name as keyof typeof c], name).toBeInstanceOf(Adapter);
    expect(c.settings.get()).toMatchObject({ ...QA_ENV, REGION: 'us-east-1' });
    for (const spy of calls) expect(spy).not.toHaveBeenCalled();
  });

  it('T-WAUTH-19: the DynamoDB stores use the tables from the settings and share one client', () => {
    noNetwork();
    stubQa();
    const c = createContainer();
    for (const store of [c.sessionStore, c.preAuthStore, c.counter, c.powStore]) expect(inner(store).table).toBe(QA_ENV.SESSIONS_TABLE);
    expect(inner(c.accountStore).table).toBe(QA_ENV.ACCOUNTS_TABLE);
    const client = inner(c.sessionStore).client;
    expect(client).toBeInstanceOf(DynamoDBDocumentClient);
    for (const store of [c.preAuthStore, c.counter, c.powStore, c.accountStore]) expect(inner(store).client).toBe(client);
  });

  it("T-WAUTH-19: every SDK client takes the region from the settings: the runtime's, else us-east-1 (D-159)", async () => {
    noNetwork();
    for (const [runtime, expected] of [
      ['', 'us-east-1'],
      ['eu-west-1', 'eu-west-1'],
    ]) {
      stubQa({ AWS_REGION: runtime });
      delete (globalThis as { [SHARED]?: unknown })[SHARED];
      const c = createContainer();
      expect(c.settings.get().REGION).toBe(expected);
      for (const adapter of [c.secretStore, c.identityProvider, c.sessionStore, c.accountStore]) {
        expect(await inner(adapter).client!.config.region(), runtime).toBe(expected);
      }
    }
  });

  it('T-WAUTH-19: one container per process: every call outside STAGE=test returns the same one', () => {
    noNetwork();
    stubQa();
    const c = createContainer();
    expect(createContainer()).toBe(c);
    expect(getContainer()).toBe(c);
  });

  it('T-WAUTH-19: a missing or invalid setting fails with an error naming the setting, never its value', () => {
    noNetwork();
    stubQa({ USER_POOL_ID: '' });
    expect(() => createContainer()).toThrow(/Web server settings missing or invalid: USER_POOL_ID$/);
    const leaked = 'not-an-arn-but-a-pasted-secret-value';
    stubQa({ WEB_CLIENT_SECRET_ARN: leaked });
    let message = '';
    try {
      createContainer();
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toMatch(/WEB_CLIENT_SECRET_ARN/);
    expect(message).not.toContain(leaked);
    stubQa({ WEB_ORIGIN: 'http://qa.example.test' });
    expect(() => createContainer()).toThrow(/WEB_ORIGIN/);
    // A failed build is not kept: once the settings are fixed the next call builds the container.
    stubQa();
    expect(createContainer().settings.get().WEB_ORIGIN).toBe(QA_ENV.WEB_ORIGIN);
  });

  // SF-161 (D-167): the real data API adapter replaces the fail-closed one; a token without a person never leaves.
  it('T-WAUTH-19: the data API is the HTTP adapter, and a token without a person is refused without a request', async () => {
    const calls = noNetwork();
    stubQa();
    const api = createContainer().dataApi;
    expect(api).toBeInstanceOf(HttpDataApi);
    expect(await api.rates('example-token', {})).toEqual({ ok: false, kind: 'unauthorized' });
    for (const spy of calls) expect(spy).not.toHaveBeenCalled();
  });

  it('T-WAUTH-19: until PR 4 the parameter store fails closed (a refusal, never a missing value) and logs once', async () => {
    noNetwork();
    stubQa();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const params = createContainer().parameterStore;
    await expect(params.get('/smart-finances/qa/imports-paused')).rejects.toThrow(/not wired/);
    await expect(params.get('/smart-finances/qa/imports-paused')).rejects.toThrow(/not wired/);
    const lines = log.mock.calls.map((args) => JSON.parse(String(args[0])) as Record<string, string>);
    expect(lines.filter((l) => l.event === 'adapter_unavailable' && l.outcome === 'parameter_store')).toHaveLength(1);
  });
});
