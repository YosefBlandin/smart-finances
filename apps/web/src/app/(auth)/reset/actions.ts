'use server';

import { getLocale } from 'next-intl/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createReset, RESET_NOTICE, type ResetContext } from '@/application/auth/reset';
import type { Lang } from '@/ports/identity-provider';
import { clearPreAuthCookie, readPreAuthCookie, setPreAuthCookie } from '../../cookies';
import { guarded, type ActionResult } from '../../guarded';

// The reset server actions (D-125): ask for a code, then the code with the new password, and "Send a new code", each
// through guarded() (exact Origin, proof of work, auth posts per address, Zod input) and the reset use case with the
// shared container. A changed password has already signed the person out everywhere (D-92); the action clears
// __Host-pre, sets the 10-minute HttpOnly notice cookie the sign-in screen reads (D-122) and opens /sign-in.

const lang = async (): Promise<Lang> => ((await getLocale()) === 'es' ? 'es' : 'en');

const ForgotInput = z.object({ email: z.string().trim().max(254).email() });
// The length rule (12 to 128) is the use case's, so a short password gets its own message, not auth.invalid.
const ConfirmInput = z.object({ code: z.string().trim().min(1).max(16), password: z.string().min(1).max(1024) });

const context = async (requestId: string, ip: string | undefined): Promise<ResetContext> => ({
  requestId,
  ip,
  lang: await lang(),
  preAuthId: await readPreAuthCookie(),
});

const forgotGuarded = guarded(ForgotInput, { kind: 'auth' }, async (input, { container, requestId, ip }): Promise<ActionResult<null>> => {
  const result = await createReset(container).forgot(input, await context(requestId, ip));
  if (!result.ok) return result;
  await setPreAuthCookie(result.data.preAuthId);
  redirect('/reset/confirm');
});

const confirmGuarded = guarded(ConfirmInput, { kind: 'auth' }, async (input, { container, requestId, ip }): Promise<ActionResult<null>> => {
  const result = await createReset(container).confirm(input, await context(requestId, ip));
  if (!result.ok) return result;
  await clearPreAuthCookie();
  // Only when every session really ended (the use case names the notice then).
  if (result.data.notice) {
    (await cookies()).set(RESET_NOTICE.cookie, result.data.notice, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: RESET_NOTICE.maxAgeSeconds,
    });
  }
  redirect(result.data.next);
});

const resendGuarded = guarded(z.object({}), { kind: 'auth' }, async (_input, { container, requestId, ip }) =>
  createReset(container).resend(await context(requestId, ip)),
);

export type FormState = ActionResult<unknown> | null;

export async function forgotAction(prev: FormState, form: FormData): Promise<FormState> {
  return forgotGuarded(prev, form);
}

export async function resetConfirmAction(prev: FormState, form: FormData): Promise<FormState> {
  return confirmGuarded(prev, form);
}

export async function resetResendAction(prev: FormState, form: FormData): Promise<FormState> {
  return resendGuarded(prev, form);
}
