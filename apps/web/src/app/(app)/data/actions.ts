'use server';

import { z } from 'zod';
import { createErase, type Erased, type EraseRefusal } from '@/application/data/erase';
import { ERASE_MESSAGES } from '@/screens/data/model';
import { GUARD_MESSAGES, guarded, type ActionResult } from '../../guarded';

// Erase my data (SF-168; AC-7, D-125, D-131): a money action through guarded() (exact Origin, then the session, consent
// and an active account), with the typed word DELETE as its input, then the erase use case for that session's person.
// It waits for the API's answer (no optimistic update) and returns the counts erased, or a plain refusal. A refusal that
// may have left the erase unfinished has its own message, so the screen can offer Finish erasing (this same action).

const confirm = z.object({ confirm: z.literal('DELETE') });

/** The message for each refusal; the screen offers Finish erasing for the unfinished one only. */
const MESSAGES: Record<EraseRefusal, string> = {
  unfinished: ERASE_MESSAGES.unfinished,
  running: ERASE_MESSAGES.running,
  limited: ERASE_MESSAGES.failed,
  failed: ERASE_MESSAGES.failed,
  'signed-out': GUARD_MESSAGES.sessionEnded,
};

export const eraseData = guarded(confirm, { kind: 'money' }, async (_input, { container, session }): Promise<ActionResult<Erased>> => {
  const result = await createErase(container).erase(session!);
  if (result.ok) return { ok: true, data: result.data };
  const messageKey = MESSAGES[result.reason];
  return result.retryAfter === undefined ? { ok: false, messageKey } : { ok: false, messageKey, retryAfterSeconds: result.retryAfter };
});
