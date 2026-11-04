import { randomUUID } from 'node:crypto';
import { headers as requestHeaders } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import type { z } from 'zod';
import { getContainer, type Container } from '@/adapters/container';
import { createLimits } from '@/application/limits';
import { createPow } from '@/application/pow';
import { clientIp } from '@/domain/limits';

// guarded() wraps every server action (D-125). For an auth action it checks, in order: the exact Origin against the
// stage's WEB_ORIGIN (a missing or null Origin is refused, D-115; the middleware's Referrer-Policy same-origin keeps the
// real Origin on our own posts, D-153), then the proof-of-work answer (powSalt, powN, powSig; D-120), then the auth
// posts per address prefix (the right-most X-Forwarded-For entry), then the Zod input (D-124). Only then does the action
// run. It answers { ok: true, data } or { ok: false, messageKey, retryAfterSeconds? } and never throws to the client:
// an unexpected failure is auth.unavailable with no detail. Next.js control flow (redirect, notFound) still propagates.
// SF-150 adds kind "money" (requireMoneyAccess before the input).

export type Refusal = { ok: false; messageKey: string; retryAfterSeconds?: number };
export type ActionResult<T> = { ok: true; data: T } | Refusal;
export type GuardOptions = { kind: 'auth' };
export type GuardContext = { container: Container; requestId: string; ip: string | undefined };

/** The refusals guarded() itself gives; each is a key in messages/en.json and es.json. */
export const GUARD_MESSAGES = {
  forbidden: 'auth.forbidden',
  proofFailed: 'auth.proofFailed',
  limited: 'auth.limited',
  invalid: 'auth.invalid',
  unavailable: 'auth.unavailable',
} as const;

export type GuardDeps = { headers: () => Promise<Headers>; container: () => Container };

const POW_FIELDS = ['powSalt', 'powN', 'powSig'] as const;

const refuse = (messageKey: string, retryAfterSeconds?: number): Refusal =>
  retryAfterSeconds === undefined ? { ok: false, messageKey } : { ok: false, messageKey, retryAfterSeconds };

/** A form (alone, or after useActionState's previous state) or a plain object, as one record; Next.js's own $ACTION fields are dropped. */
function fieldsOf(args: unknown[]): Record<string, unknown> {
  const input = args[args.length - 1];
  const out: Record<string, unknown> = {};
  if (input instanceof FormData) {
    for (const key of new Set(input.keys())) {
      if (key.startsWith('$ACTION')) continue;
      const all = input.getAll(key);
      out[key] = all.length === 1 ? all[0] : all;
    }
    return out;
  }
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const [key, value] of Object.entries(input)) if (!key.startsWith('$ACTION')) out[key] = value;
  }
  return out;
}

export function createGuarded(deps: GuardDeps) {
  return function guarded<S extends z.ZodType, T>(
    schema: S,
    opts: GuardOptions,
    fn: (input: z.output<S>, ctx: GuardContext) => Promise<ActionResult<T>>,
  ): (...args: unknown[]) => Promise<ActionResult<T>> {
    return async (...args) => {
      try {
        const container = deps.container();
        const h = await deps.headers();
        const requestId = randomUUID();

        // 1. The exact Origin (D-115): equal to the stage's web address, nothing looser.
        const origin = h.get('origin');
        if (!origin || origin.toLowerCase() === 'null' || origin !== container.settings.get().WEB_ORIGIN) return refuse(GUARD_MESSAGES.forbidden);

        const fields = fieldsOf(args);
        const ip = clientIp(h.get('x-forwarded-for'));

        if (opts.kind === 'auth') {
          // 2. The proof of work, claimed once. A refused answer is not counted, so a flood without one locks nobody out.
          const verdict = await createPow(container).verify({ salt: fields.powSalt, n: fields.powN, sig: fields.powSig });
          if (!verdict.ok) return refuse(GUARD_MESSAGES.proofFailed);

          // 3. Auth posts per address prefix (D-120).
          const hit = await createLimits(container).hit('ip-auth', ip);
          if (!hit.ok) {
            container.logger.event('rate_limited', 'ip-auth', { requestId });
            return refuse(GUARD_MESSAGES.limited, hit.retryAfterSeconds);
          }
        }
        for (const key of POW_FIELDS) delete fields[key];

        // 4. The input (D-124).
        const parsed = schema.safeParse(fields);
        if (!parsed.success) return refuse(GUARD_MESSAGES.invalid);

        const result = await fn(parsed.data, { container, requestId, ip });
        return result.ok ? { ok: true, data: result.data } : refuse(result.messageKey, result.retryAfterSeconds);
      } catch (err) {
        unstable_rethrow(err);
        return refuse(GUARD_MESSAGES.unavailable);
      }
    };
  };
}

/** guarded(schema, { kind: 'auth' }, fn): the server action for fn, behind the checks above. */
export const guarded = createGuarded({ headers: async () => new Headers(await requestHeaders()), container: getContainer });
