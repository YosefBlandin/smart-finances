'use server';

import { CATEGORIES } from '@smart-finances/contracts/categories';
import { z } from 'zod';
import { createLabel } from '@/application/data/label';
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

// A recipient label (mercadopago-enrichment D-7, D-13, D-22): the same guarded money action as a review choice, then the
// use case for that session's person only. The key is the row's recipient key; the category is never Uncategorized.
const label = z.object({
  key: z.string().regex(/^[0-9a-f]{32}$/),
  name: z.string().trim().min(1).max(80),
  category: z.enum(CATEGORIES).refine((c) => c !== 'Uncategorized'),
});

export const labelRecipient = guarded(label, { kind: 'money' }, async (input, { container, session, requestId }): Promise<ActionResult<null>> => {
  const saved = await createLabel(container).label(session!, input, { requestId });
  return saved.ok ? { ok: true, data: null } : { ok: false, messageKey: 'review.saveFailed', retryAfterSeconds: saved.retryAfter };
});
