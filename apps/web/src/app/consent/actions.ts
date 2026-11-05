'use server';

import { getLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { safeNext } from '@/application/auth/signIn';
import { createGuard } from '@/application/guard';
import { createSessions } from '@/application/session';
import { clearSessionCookie, readSessionCookie } from '../cookies';
import { guarded, type ActionResult } from '../guarded';

// The consent screen's server actions (D-87, D-145, D-125), and the one behind the "session ended" screen. Each goes
// through guarded() as an auth post (exact Origin, proof of work, auth posts per address, Zod input): the consent step
// sits between the code and the first money screen, before the money guard can pass. Accept records the versions the
// screen showed, only while they are current; refusing signs out (the row goes, the refresh token is revoked and
// __Host-sid is cleared). The ended screen clears a __Host-sid whose session is gone, so the middleware stops sending
// the browser from /sign-in back to the money screens, and keeps the page for after sign-in.

const Version = z.string().trim().min(1).max(32);
const AcceptInput = z.object({ accept: z.literal('on').optional(), terms: Version, privacy: Version });
const LeaveInput = z.object({ next: z.string().max(512).optional(), reason: z.enum(['idle']).optional() });

const lang = async () => ((await getLocale()) === 'es' ? ('es' as const) : ('en' as const));

const acceptGuarded = guarded(AcceptInput, { kind: 'auth' }, async (input, { container }): Promise<ActionResult<null>> => {
  if (input.accept !== 'on') return { ok: false, messageKey: 'auth.signUp.errAccept' };
  const result = await createGuard(container).acceptConsent(await readSessionCookie(), { terms: input.terms, privacy: input.privacy }, await lang());
  if (result.ok) redirect('/overview');
  switch (result.reason) {
    case 'changed':
      return { ok: false, messageKey: 'auth.consent.errChanged' };
    case 'deleting':
      return { ok: false, messageKey: 'auth.forbidden' };
    default:
      await clearSessionCookie();
      redirect('/sign-in?reason=idle');
  }
});

const declineGuarded = guarded(z.object({}), { kind: 'auth' }, async (_input, { container, requestId }): Promise<ActionResult<null>> => {
  await createGuard(container).declineConsent(await readSessionCookie(), { requestId });
  await clearSessionCookie();
  redirect('/sign-in');
});

const leaveGuarded = guarded(LeaveInput, { kind: 'auth' }, async (input, { container }): Promise<ActionResult<null>> => {
  // Ends whatever is left of the session (nothing, when the row is already gone) and clears the cookie.
  await createSessions(container).endSession(await readSessionCookie());
  await clearSessionCookie();
  const query = new URLSearchParams();
  if (input.reason) query.set('reason', input.reason);
  const next = safeNext(input.next);
  if (next !== '/overview') query.set('next', next);
  const search = query.toString();
  redirect(search ? `/sign-in?${search}` : '/sign-in');
});

export type FormState = ActionResult<unknown> | null;

export async function acceptConsentAction(prev: FormState, form: FormData): Promise<FormState> {
  return acceptGuarded(prev, form);
}

export async function declineConsentAction(prev: FormState, form: FormData): Promise<FormState> {
  return declineGuarded(prev, form);
}

export async function leaveAction(prev: FormState, form: FormData): Promise<FormState> {
  return leaveGuarded(prev, form);
}
