'use server';

import { CATEGORIES } from '@smart-finances/contracts/categories';
import { z } from 'zod';
import { createReview } from '@/application/data/review';
import { guarded, type ActionResult } from '../../guarded';

// A review choice (SF-166; D-125, D-131): a money action through guarded() (exact Origin, then the session, consent and
// an active account), then the use case for that session's person only. The screen shows the choice at once and rolls
// it back when this answers a refusal; nothing about the refusal's cause reaches the page beyond its plain message.

const choice = z
  .object({
    id: z.string().min(1).max(200),
    date: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/),
    category: z.enum(CATEGORIES).optional(),
    approved: z.literal(true).optional(),
  })
  .refine((c) => c.category !== undefined || c.approved !== undefined);

export const chooseReview = guarded(choice, { kind: 'money' }, async (input, { container, session }): Promise<ActionResult<null>> => {
  const saved = await createReview(container).choose(session!, input);
  return saved.ok ? { ok: true, data: null } : { ok: false, messageKey: 'review.saveFailed', retryAfterSeconds: saved.retryAfter };
});
