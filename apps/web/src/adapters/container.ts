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
import { fixtureSeed, MemoryDataApi } from './memory/data-api';
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

// PR 4 adds the parameter store adapter (SF-167). Until then a real stage fails closed on it: a parameter read is refused
// (never read as "not set", which could mean "imports not paused"), and logged once per process, so the log shows why
// without a line per request. The data API adapter is wired (SF-161, D-167).
function logOnce(logger: Logger, outcome: string): () => void {
  let logged = false;
  return () => {
    if (logged) return;
    logged = true;
    logger.event('adapter_unavailable', outcome, { requestId: 'container' });
  };
}

export class UnwiredParameterStore implements ParameterStore {
  private readonly log: () => void;
  constructor(logger: Logger) {
    this.log = logOnce(logger, 'parameter_store');
  }
  async get(): Promise<string | undefined> {
    this.log();
    throw new Error('The parameter store is not wired until PR 4');
  }
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
    parameterStore: new UnwiredParameterStore(logger),
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
 * STAGE=test only: one signed-in person with the current consent in the shared container, so the browser tests of the
 * money screens (e2e/shell, states and headers) open them with this __Host-sid instead of walking sign-up, the code and
 * consent each time. Synthetic: a fixed id that is no secret, a made-up sub, unsigned test tokens (the access token's exp
 * is 12 hours out, so no refresh is attempted). It lives only in the memory stores of a STAGE=test server; real stages
 * never build a memory container.
 */
export const TEST_PERSON = {
  sessionId: 'e2e-test-person-session-not-a-secret-000000',
  sub: '00000000-0000-4000-9000-0000000000e2',
  email: 'you@example.com',
} as const;

function seedTestPerson(c: Container) {
  const now = c.clock.now();
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = (claims: object) => `${part({ alg: 'none' })}.${part(claims)}.test`;
  const { sub, email } = TEST_PERSON;
  const accessToken = token({ sub, exp: Math.floor((now + SESSION_ABSOLUTE_MS) / 1000), token_use: 'access' });
  // The money screens read the fixtures (sample plus hostile rows) through a memory data API that counts the person's
  // requests like the real one (5 a minute under STAGE=test), so the 429 page can be reached (SF-161, SF-172).
  const dataApi = new MemoryDataApi(c.clock, { limits: c, logger: c.logger });
  dataApi.seed(fixtureSeed());
  dataApi.allowToken(accessToken);
  c.dataApi = dataApi;
  // The memory stores apply these at once (their methods do not await), so the person exists before the first request.
  void c.sessionStore.create({
    idHash: createHash('sha256').update(TEST_PERSON.sessionId).digest('hex'),
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
