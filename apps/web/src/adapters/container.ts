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
import type { Settings } from '@/ports/settings';
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
import { parseSettings } from './env-settings';
import { MemorySettings } from './memory/settings';

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

// The only place that reads STAGE to choose behaviour. Real adapters are added by PR 3 and PR 4.
export function createContainer(): Container {
  // STAGE=test: the test defaults, with any setting the environment names (a local port, say) taking precedence.
  if (process.env.STAGE === 'test') return memoryContainer(new MemorySettings(parseSettings(process.env)));
  throw new Error(`No real adapters yet for STAGE=${process.env.STAGE ?? ''}; PR 3 and PR 4 add them.`);
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
  // The memory stores apply these at once (their methods do not await), so the person exists before the first request.
  void c.sessionStore.create({
    idHash: createHash('sha256').update(TEST_PERSON.sessionId).digest('hex'),
    sub,
    accessToken: token({ sub, exp: Math.floor((now + SESSION_ABSOLUTE_MS) / 1000), token_use: 'access' }),
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
// proof-of-work claim or a counter from one request to the next, and real adapters reuse their SDK clients. It lives on
// globalThis so every bundle of the app sees the same one. A failed build is not kept, so the next call tries again.
// Under STAGE=test it also holds TEST_PERSON.
export function getContainer(): Container {
  const g = globalThis as WithShared;
  if (!g[SHARED]) {
    if (process.env.STAGE === 'test') {
      const c = memoryContainer(new MemorySettings(parseSettings(process.env)), new SystemClock());
      seedTestPerson(c);
      g[SHARED] = c;
    } else {
      g[SHARED] = createContainer();
    }
  }
  return g[SHARED];
}
