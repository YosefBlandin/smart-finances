'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSignOut } from '@/application/auth/signOut';
import { clearSessionCookie, readSessionCookie } from '../cookies';
import { GUARD_MESSAGES, guarded, type ActionResult } from '../guarded';

// The money screens' server actions (D-125). Sign out (AC-16, D-72, D-115: a post) is the Shell's Sign out row: through
// guarded() as a money action (exact Origin, then the session, consent and account; allowDeleting, so a person whose
// account is being deleted can still leave, D-104), it deletes this browser's session row, revokes its refresh token,
// clears __Host-sid and opens /sign-in. Owner decision on the SF-151 deviation. A post whose session has already ended
// (idle, 12 hours, a reset elsewhere) passed the Origin check, so it clears the stale cookie and opens sign-in with the
// idle note; any other refusal (a foreign or missing Origin above all) ends and clears nothing.

const signOutGuarded = guarded(
  z.object({}),
  { kind: 'money', allowDeleting: true },
  async (_input, { container, requestId }): Promise<ActionResult<null>> => {
    await createSignOut(container)(await readSessionCookie(), { requestId });
    await clearSessionCookie();
    redirect('/sign-in');
  },
);

export async function signOutAction(form: FormData): Promise<void> {
  const result = await signOutGuarded(form);
  if (result.ok) return;
  if (result.messageKey === GUARD_MESSAGES.sessionEnded) {
    await clearSessionCookie();
    redirect('/sign-in?reason=idle');
  }
  if (result.messageKey === GUARD_MESSAGES.consentNeeded) redirect('/consent');
}
