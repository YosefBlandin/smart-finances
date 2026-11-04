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
  const logger = new MemoryLogger();
  return {
    clock,
    settings,
    secretStore: new MemorySecretStore(),
    parameterStore: new MemoryParameterStore(),
    logger,
    sessionStore: new MemorySessionStore(clock),
    preAuthStore: new MemoryPreAuthStore(clock),
    counter: new MemoryCounter(clock),
    powStore: new MemoryPowStore(clock),
    accountStore: new MemoryAccountStore(),
    breachChecker: new MemoryBreachChecker(logger),
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

const SHARED = Symbol.for('smart-finances.container');
type WithShared = typeof globalThis & { [SHARED]?: Container };

// One container per server process, for server actions (guarded()): under STAGE=test the memory stores must keep a
// proof-of-work claim or a counter from one request to the next, and real adapters reuse their SDK clients. It lives on
// globalThis so every bundle of the app sees the same one. A failed build is not kept, so the next call tries again.
export function getContainer(): Container {
  const g = globalThis as WithShared;
  if (!g[SHARED]) {
    g[SHARED] = process.env.STAGE === 'test' ? memoryContainer(new MemorySettings(parseSettings(process.env)), new SystemClock()) : createContainer();
  }
  return g[SHARED];
}
