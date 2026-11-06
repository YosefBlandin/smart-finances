'use server';

import { z } from 'zod';
import { createImports } from '@/application/data/requestImport';
import { refusalKey } from '@/screens/imports/model';
import { guarded, type ActionResult } from '../../guarded';

// An import request (SF-167; D-114, D-125): a money action through guarded() (exact Origin, then the session, consent and
// an active account), then the import use case for that session's person: the name and size check, the pause switch,
// the caps, POST /imports and the slot. It answers the presigned upload form, which the browser posts the file to, or a
// plain refusal; nothing about a refusal's cause reaches the page beyond its message.

const request = z.object({
  source: z.string().min(1).max(40),
  fileName: z.string().min(1).max(255),
  size: z.number().int().min(0),
});

export type ImportStart = { importId: string; upload: { url: string; fields: Record<string, string> } };

export const requestImport = guarded(request, { kind: 'money' }, async (input, { container, session }): Promise<ActionResult<ImportStart>> => {
  const started = await createImports(container).requestImport(session!, input);
  if (started.ok) return { ok: true, data: { importId: started.data.importId, upload: started.data.upload } };
  const refusal = { ok: false as const, messageKey: refusalKey(started.reason, input.source) };
  return started.retryAfter === undefined ? refusal : { ...refusal, retryAfterSeconds: started.retryAfter };
});
