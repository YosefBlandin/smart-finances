'use server';

import { getLocale } from 'next-intl/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createDeleteAccount } from '@/application/account/deleteAccount';
import { GOODBYE, sessionsGoneAt, type Goodbye } from '@/domain/deletion';
import { clearSessionCookie } from '../../../cookies';
import { guarded, type ActionResult } from '../../../guarded';
import { DELETE_REFUSALS } from './model';

// Delete the account (SF-169; AC-18, D-104, D-125, D-146). Two money actions through guarded():
//  startDeletion: the full re-sign-in (email, password and authenticator code of the signed-in person) with the typed
//    word DELETE, then no running import, then the account is marked deleting. A refusal deletes nothing.
//  finishDeletion (allowDeleting, so the session that marked the account may reach it, D-104): the steps of
//    domain/deletion.ts. When every step finished, or a step after the sessions were ended stopped it (the hourly job
//    finishes those), it sets the signed goodbye cookie (5 minutes, HttpOnly, Secure, SameSite=Lax), clears __Host-sid
//    and opens /goodbye. When the erase stopped it, the person is still signed in and the page offers Finish deleting
//    (this same action again).

const lang = async () => ((await getLocale()) === 'es' ? 'es' : 'en');

const reauth = z.object({
  email: z.string().trim().max(254).email(),
  password: z.string().min(1).max(1024),
  code: z.string().trim().min(1).max(16),
  confirm: z.literal('DELETE'),
});

export const startDeletion = guarded(reauth, { kind: 'money' }, async (input, { container, requestId, ip, session }): Promise<ActionResult<null>> => {
  const started = await createDeleteAccount(container).start(session!, input, { requestId, ip, lang: await lang() });
  return started.ok ? { ok: true, data: null } : started;
});

export const finishDeletion = guarded(
  z.object({}),
  { kind: 'money', allowDeleting: true },
  async (_input, { container, requestId, session }): Promise<ActionResult<null>> => {
    const deletion = createDeleteAccount(container);
    const result = await deletion.finish(session!, { requestId });
    if (!result.ok && result.reason === 'not-deleting') return { ok: false, messageKey: DELETE_REFUSALS.notStarted };
    if (!result.ok && !sessionsGoneAt(result.step)) return { ok: false, messageKey: DELETE_REFUSALS.unfinished };

    const goodbye: Goodbye = result.ok
      ? { erased: result.erased, closed: 'done' }
      : { ...(result.erased ? { erased: result.erased } : {}), closed: 'partial' };
    (await cookies()).set(GOODBYE.cookie, await deletion.goodbye(goodbye), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: GOODBYE.maxAgeSeconds,
    });
    await clearSessionCookie();
    redirect('/goodbye');
  },
);
