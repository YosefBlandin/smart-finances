'use server';

import { z } from 'zod';
import { createSetRate, isRate } from '@/application/data/setRate';
import { guarded, type ActionResult } from '../../guarded';

// A month's dollar rate (SF-166; D-125, D-131): a money action through guarded(), then the use case for that session's
// person only. Two decimals at most, above 0 (the contracts' PUT /rates/{month}); the screen shows it at once and rolls
// it back when this answers a refusal.

const rate = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  arsPerUsd: z.number().refine(isRate),
});

export const saveRate = guarded(rate, { kind: 'money' }, async ({ month, arsPerUsd }, { container, session }): Promise<ActionResult<null>> => {
  const saved = await createSetRate(container).setRate(session!, month, arsPerUsd);
  return saved.ok ? { ok: true, data: null } : { ok: false, messageKey: 'rates.saveFailed', retryAfterSeconds: saved.retryAfter };
});
