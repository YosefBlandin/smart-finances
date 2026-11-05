import {
  counterKey,
  counterSubject,
  counterTtl,
  decide,
  hmacValue,
  limitsFor,
  windowStart,
  type HitResult,
  type LimitInput,
  type LimitScope,
  type WindowCount,
} from '@/domain/limits';
import type { Clock } from '@/ports/clock';
import type { Counter } from '@/ports/counter';
import type { SecretStore } from '@/ports/secret-store';
import type { Settings } from '@/ports/settings';

// The window counters (D-120; architecture.md Contracts "Limits"). hit() counts one event for a scope and says whether
// it is within every window of that scope; a refused event is counted too, so hammering keeps the window full. The key
// is an HMAC of what is counted under the stage's HMAC secret (D-115), so the counters table holds no email, address
// or sub. Callers: guarded() for auth posts per address, the sign-in and reset use cases for failures, the code-email
// senders, and the data reads per person. A counter or secret failure is thrown; guarded() turns it into a message.

export type LimitsDeps = { counter: Counter; clock: Clock; secretStore: SecretStore; settings: Settings };
export type { HitResult, LimitInput, LimitScope };

export function createLimits({ counter, clock, secretStore, settings }: LimitsDeps) {
  async function hit<S extends LimitScope>(scope: S, value: LimitInput[S]): Promise<HitResult> {
    const { STAGE, HMAC_SECRET_ARN } = settings.get();
    const secret = await secretStore.get(HMAC_SECRET_ARN);
    const hashed = hmacValue(secret, counterSubject(scope, value));
    const now = clock.now();
    const counts: WindowCount[] = [];
    for (const window of limitsFor(STAGE)[scope]) {
      const start = windowStart(now, window.ms);
      const n = await counter.incr(counterKey(window.id, hashed), start, counterTtl(window.ms));
      counts.push({ window, start, n });
    }
    return decide(counts, now);
  }

  return { hit };
}

export type Limits = ReturnType<typeof createLimits>;
