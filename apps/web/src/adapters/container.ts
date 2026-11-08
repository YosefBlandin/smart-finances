import { createHash } from 'node:crypto';
import { SESSION_ABSOLUTE_MS } from '@/domain/session-policy';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/legal/versions';
import type { AccountStore } from '@/ports/account-store';
import type { BreachChecker } from '@/ports/breach-checker';
import type { Clock } from '@/ports/clock';
import type { Counter } from '@/ports/counter';
import type { DataApi } from '@/ports/data-api';
import type { IdentityProvider } from '@/ports/identity-provider';
import type { Logger } from '@/ports/logger';
import type { ParameterStore } from '@/ports/parameter-store';
import type { PowStore } from '@/ports/pow-store';
import type { PreAuthStore } from '@/ports/pre-auth-store';
import type { SecretStore } from '@/ports/secret-store';
import type { SessionStore } from '@/ports/session-store';
import type { Settings, WebSettings } from '@/ports/settings';
import { CognitoIdentityProvider } from './cognito';
import { HttpDataApi } from './data-api';
import { DynamoAccountStore } from './dynamodb/accounts';
import { DynamoCounter } from './dynamodb/counters';
import { DynamoPowStore } from './dynamodb/pow';
import { documentClient, DynamoPreAuthStore, DynamoSessionStore } from './dynamodb/sessions';
import { EnvSettings, parseSettings } from './env-settings';
import { JsonLogger } from './log';
import { MemoryAccountStore } from './memory/account-store';
import { MemoryBreachChecker } from './memory/breach-checker';
import { MemoryClock, SystemClock } from './memory/clock';
import { MemoryCounter } from './memory/counter';
import { FailingDataApi, fixtureSeed, MemoryDataApi, PersonDataApis, RefusingDataApi } from './memory/data-api';
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
import { SsmParameterStore } from './ssm';

// One adapter per port (architecture.md Contracts "Ports"). app/ reaches application/ through this file only (D-138).
export type Container = {
  clock: Clock;
  settings: Settings;
  secretStore: SecretStore;
  parameterStore: ParameterStore;
  logger: Logger;
  sessionStore: SessionStore;
  preAuthStore: PreAuthStore;
  counter: Counter;
  powStore: PowStore;
  accountStore: AccountStore;
  breachChecker: BreachChecker;
  identityProvider: IdentityProvider;
  dataApi: DataApi;
};

export const PORT_NAMES = [
  'clock',
  'settings',
  'secretStore',
  'parameterStore',
  'logger',
  'sessionStore',
  'preAuthStore',
  'counter',
  'powStore',
  'accountStore',
  'breachChecker',
  'identityProvider',
  'dataApi',
] as const satisfies readonly (keyof Container)[];

export function memoryContainer(settings: Settings = new MemorySettings(), clock: Clock = new MemoryClock(Date.now())): Container {
  return {
    clock,
    settings,
    secretStore: new MemorySecretStore(),
    parameterStore: new MemoryParameterStore(),
    logger: new MemoryLogger(),
    sessionStore: new MemorySessionStore(clock),
    preAuthStore: new MemoryPreAuthStore(clock),
    counter: new MemoryCounter(clock),
    powStore: new MemoryPowStore(clock),
    accountStore: new MemoryAccountStore(),
    breachChecker: new MemoryBreachChecker(),
    identityProvider: new MemoryIdentityProvider(clock),
    dataApi: new MemoryDataApi(clock),
  };
}

/**
 * The real adapters of qa, staging and prod, built from the settings (D-138). Every AWS SDK client takes the region
 * from the settings (the runtime's, else us-east-1; D-159) and is only constructed here: nothing is sent until a use
 * case calls a port. The five DynamoDB stores share one document client; secrets are read at run time by ARN (D-73).
 */
export function realContainer(settings: Settings, clock: Clock = new SystemClock()): Container {
  const s: WebSettings = settings.get();
  const region = s.REGION;
  const logger = new JsonLogger({ clock });
  const secretStore = new SecretsManagerStore({ region, clock });
  const client = documentClient(region);
  const sessions = { client, tableName: s.SESSIONS_TABLE };
  const sessionStore = new DynamoSessionStore({ ...sessions, clock });
  const counter = new DynamoCounter(sessions);
  const identityProvider = new CognitoIdentityProvider({
    region,
    userPoolId: s.USER_POOL_ID,
    clientId: s.WEB_CLIENT_ID,
    clientSecretArn: s.WEB_CLIENT_SECRET_ARN,
    secretStore,
    clock,
  });
  return {
    clock,
    settings,
    secretStore,
    parameterStore: new SsmParameterStore({ region, clock }),
    logger,
    sessionStore,
    preAuthStore: new DynamoPreAuthStore({ ...sessions, clock }),
    counter,
    powStore: new DynamoPowStore({ ...sessions, clock }),
    accountStore: new DynamoAccountStore({ client, tableName: s.ACCOUNTS_TABLE }),
    breachChecker: new PwnedPasswordsChecker(),
    identityProvider,
    dataApi: new HttpDataApi({ counter, clock, secretStore, settings, sessionStore, identityProvider, logger }),
  };
}

/**
 * STAGE=test, but never inside an AWS runtime: the memory container takes fixed codes and holds a seeded test person, so
 * a deployed process that is handed STAGE=test by mistake refuses to start instead of opening that door.
 */
function isTestStage(): boolean {
  if (process.env.STAGE !== 'test') return false;
  if (process.env.AWS_EXECUTION_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    throw new Error('STAGE=test is refused in a deployed runtime (AWS_EXECUTION_ENV or AWS_LAMBDA_FUNCTION_NAME is set)');
  }
  return true;
}

/**
 * The only place that reads STAGE to choose behaviour. STAGE=test: fresh memory adapters on each call (the test
 * defaults, with any setting the environment names, a local port say, taking precedence). Any other stage: the one real
 * container of this process (getContainer), so SDK clients and the secret cache are reused across requests. A missing
 * or invalid setting throws an error naming the setting, never its value.
 */
export function createContainer(): Container {
  if (isTestStage()) return memoryContainer(new MemorySettings(parseSettings(process.env)));
  return getContainer();
}

/**
 * STAGE=test only: one signed-in person with the current consent in the shared container, so a browser test of a money
 * screen that reads no data (e2e/states) opens it with this __Host-sid instead of walking sign-up, the code and consent
 * each time; a test that reads data uses its own person (E2E_PEOPLE). Synthetic: a fixed id that is no secret, a made-up sub, unsigned test tokens (the access token's exp
 * is 12 hours out, so no refresh is attempted). It lives only in the memory stores of a STAGE=test server; real stages
 * never build a memory container.
 */
export const TEST_PERSON = {
  sessionId: 'e2e-test-person-session-not-a-secret-000000',
  sub: '00000000-0000-4000-9000-0000000000e2',
  email: 'you@example.com',
} as const;

/**
 * STAGE=test only: more people like TEST_PERSON, one per browser test that reads money data, because each person may
 * make 5 data reads a minute under STAGE=test (domain/limits.ts) and one overview first view alone makes 5 (SF-164).
 * Each has its own sub, session and token over the same fixtures; e2ePerson(name).sessionId is the cookie value:
 * e2e-<name>-not-secret- padded with zeros to the 43 characters of a session id. A browser test adds its name here and
 * uses that person only.
 */
const A11Y_SCREENS = ['overview', 'transactions', 'review', 'imports', 'rates', 'data', 'delete'] as const;
const A11Y_PEOPLE = A11Y_SCREENS.flatMap((screen) => [
  ...(['en', 'es'] as const).flatMap((lang) => (['light', 'dark'] as const).map((theme) => `a11y-${screen}-${lang}-${theme}` as const)),
  `a11y-keys-${screen}` as const,
]);

export const E2E_PEOPLE = [
  'overview-good',
  'overview-bad',
  'overview-failed',
  'overview-retry',
  'overview-signed-out',
  'transactions-paging',
  'transactions-sort',
  'transactions-signed-out',
  // e2e/shell.spec.ts and e2e/headers.spec.ts (PR 1's specs, given a person each under D-157).
  'shell-rail',
  'shell-account',
  'shell-scroll',
  'shell-focus',
  'shell-screens-overview',
  'shell-screens-transactions',
  'shell-screens-review',
  'shell-screens-imports',
  'shell-screens-rates',
  'shell-screens-data',
  'shell-topbar',
  'shell-menu',
  'shell-lang',
  'shell-lang-refused',
  'shell-lang-tablet',
  'headers-scripts',
  // e2e/review-rates.spec.ts (SF-166).
  'review-approve',
  'review-category',
  'review-rollback',
  'review-source',
  'review-empty',
  'review-failed',
  'rates-save',
  'rates-rollback',
  'rates-empty',
  'rates-failed',
  // e2e/imports.spec.ts (SF-167).
  'imports-upload',
  'imports-upload-failed',
  'imports-refused',
  'imports-es',
  // e2e/erase.spec.ts (SF-168).
  'data-erase',
  'data-erase-retry',
  // e2e/delete-account.spec.ts (SF-169): each account is deleted, so no other test uses these people.
  'delete-account',
  'delete-account-refused',
  'delete-account-retry',
  'delete-account-reload',
  // e2e/hostile.spec.ts (SF-170).
  'hostile-transactions-1',
  'hostile-transactions-2',
  'hostile-transactions-3',
  'hostile-review',
  'hostile-imports',
  // e2e/a11y.spec.ts (SF-171): one person per screen, language and colour scheme for axe, one per screen for the
  // keyboard walk, and one for the language switch.
  ...A11Y_PEOPLE,
  'a11y-lang',
  // e2e/limit.spec.ts (SF-172): one goes past the limit, the other is still served; one reads the page in Spanish.
  'limit-first',
  'limit-second',
  'limit-es',
  // apps/web/lighthouserc.json (D-188, T-WEB-17): Lighthouse CI opens every money page 5 times with this person's __Host-sid.
  'lighthouse',
] as const;

type E2EName = (typeof E2E_PEOPLE)[number];

/**
 * STAGE=test people whose data is not the fixtures as is: none at all (the empty states), a data API that fails (AC-8),
 * one whose first erase fails (SF-168), one that refuses the token at once or after two reads (signed out, SF-164,
 * SF-165), or the fixtures with reads the limit does not count (Lighthouse, T-WEB-17).
 */
type E2EData = 'empty' | 'failing' | 'erase-fails-once' | 'refused' | 'refused-after-2' | 'uncounted';
const E2E_DATA: Partial<Record<E2EName, E2EData>> = {
  // Its data API refuses its token, so the overview's prefetch signs it out (SF-164).
  'overview-signed-out': 'refused',
  // Its data API serves the shell count and the prefetch, then refuses, so a browser read is a 401 (SF-165).
  'transactions-signed-out': 'refused-after-2',
  'review-empty': 'empty',
  'review-failed': 'failing',
  'rates-empty': 'empty',
  'rates-failed': 'failing',
  // Its first erase fails as a timeout would, so Finish erasing can be shown and used (SF-168).
  'data-erase-retry': 'erase-fails-once',
  // Its first finish's erase fails (one try per finish), so Finish deleting can be shown and used (SF-169).
  'delete-account-retry': 'erase-fails-once',
  // The same, so the deletion is left unfinished and a reload shows Finish deleting (SF-169).
  'delete-account-reload': 'erase-fails-once',
  // The fixtures with reads not counted against the limit: Lighthouse makes 30 page loads in a few minutes, and the
  // 429 page is not what it measures (D-188, T-WEB-17).
  lighthouse: 'uncounted',
};

/**
 * STAGE=test people who sign in again to delete their account (SF-169): the memory identity provider holds their sign-in
 * under their own sub, with this synthetic password (e2e/delete-account.spec.ts uses it) and the test authenticator
 * code. Not a secret: it only exists in a STAGE=test server's memory.
 */
export const E2E_DELETE_PASSWORD = 'e2e delete phrase, not a secret';
const E2E_DELETE_PEOPLE: readonly E2EName[] = ['delete-account', 'delete-account-refused', 'delete-account-retry', 'delete-account-reload'];

export function e2ePerson(name: E2EName) {
  return { sessionId: `e2e-${name}-not-secret-`.padEnd(43, '0'), sub: `e2e-person-${name}`, email: `${name}@example.com` } as const;
}

const ERASE_FAILURES: Partial<Record<E2EData | 'fixtures', number>> = { 'erase-fails-once': 1 };

function seedTestPerson(c: Container) {
  // The money screens read the fixtures (sample plus hostile rows) through memory data APIs that count the person's
  // requests like the real one (5 a minute under STAGE=test), so the 429 page can be reached (SF-161, SF-172). Each
  // person has a copy of their own, so one browser test's review choice, rate or import never shows in another's (SF-166).
  // A person who signed up in a browser test (e2e/auth.spec.ts) has a memory token no seed knows: they get an empty
  // data set of their own, as on a real stage, so their money screens are not signed out (SF-164 fix round). Not
  // counted against the limit, since their sign-up flows open the overview several times a minute.
  const apis = new PersonDataApis(new MemoryDataApi(c.clock), (token) => {
    const api = new MemoryDataApi(c.clock);
    api.allowToken(token);
    return api;
  });
  c.dataApi = apis;
  const seed = fixtureSeed();
  seedPerson(c, apis, seed, TEST_PERSON);
  for (const name of E2E_PEOPLE) seedPerson(c, apis, seed, e2ePerson(name), E2E_DATA[name]);
  for (const name of E2E_DELETE_PEOPLE) {
    const { sub, email } = e2ePerson(name);
    (c.identityProvider as MemoryIdentityProvider).seedUser({ sub, email, password: E2E_DELETE_PASSWORD });
  }
}

function seedPerson(
  c: Container,
  apis: PersonDataApis,
  seed: ReturnType<typeof fixtureSeed>,
  { sessionId, sub, email }: { sessionId: string; sub: string; email: string },
  data?: E2EData,
) {
  const now = c.clock.now();
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = (claims: object) => `${part({ alg: 'none' })}.${part(claims)}.test`;
  const accessToken = token({ sub, exp: Math.floor((now + SESSION_ABSOLUTE_MS) / 1000), token_use: 'access' });
  if (data === 'failing') {
    apis.add(accessToken, new FailingDataApi());
  } else if (data === 'refused' || data === 'refused-after-2') {
    const dataApi = new MemoryDataApi(c.clock, { limits: c, logger: c.logger });
    dataApi.seed(seed);
    dataApi.allowToken(accessToken);
    apis.add(accessToken, new RefusingDataApi(dataApi, data === 'refused' ? 0 : 2));
  } else {
    const limits = data === 'uncounted' ? undefined : c;
    const dataApi = new MemoryDataApi(c.clock, { limits, logger: c.logger, eraseFailures: ERASE_FAILURES[data ?? 'fixtures'] ?? 0 });
    if (data !== 'empty') dataApi.seed(seed);
    dataApi.allowToken(accessToken);
    apis.add(accessToken, dataApi);
  }
  // The memory stores apply these at once (their methods do not await), so the person exists before the first request.
  void c.sessionStore.create({
    idHash: createHash('sha256').update(sessionId).digest('hex'),
    sub,
    accessToken,
    idToken: token({ sub, email, token_use: 'id' }),
    refreshToken: 'test-person-refresh',
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + SESSION_ABSOLUTE_MS,
  });
  void c.accountStore.putConsent(sub, { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, lang: 'en', acceptedAt: now });
}

const SHARED = Symbol.for('smart-finances.container');
type WithShared = typeof globalThis & { [SHARED]?: Container };

// One container per server process, for server actions (guarded()): under STAGE=test the memory stores must keep a
// proof-of-work claim or a counter from one request to the next, and real adapters reuse their SDK clients and the
// secret cache (on a real stage createContainer() returns this one too). It lives on
// globalThis so every bundle of the app sees the same one. A failed build is not kept, so the next call tries again.
// Under STAGE=test it also holds TEST_PERSON.
export function getContainer(): Container {
  const g = globalThis as WithShared;
  if (!g[SHARED]) {
    if (isTestStage()) {
      const c = memoryContainer(new MemorySettings(parseSettings(process.env)), new SystemClock());
      seedTestPerson(c);
      g[SHARED] = c;
    } else {
      g[SHARED] = realContainer(new EnvSettings(process.env));
    }
  }
  return g[SHARED];
}
