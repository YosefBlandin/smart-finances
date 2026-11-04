'use server';

import { getLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createConfirm } from '@/application/auth/confirm';
import { createSignUp } from '@/application/auth/signUp';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/legal/versions';
import { readPreAuthCookie, setPreAuthCookie } from '../../cookies';
import { guarded, type ActionResult } from '../../guarded';

// The sign-up and confirm server actions (D-125): each goes through guarded() (exact Origin, proof of work, auth posts
// per address, Zod input) and then calls its use case with the shared container. Success redirects; a refusal comes
// back as { ok: false, messageKey } for the form to show. The language of the code email is the page's language.

const lang = async () => ((await getLocale()) === 'es' ? 'es' : 'en');

const SignUpInput = z.object({
  email: z.string().trim().max(254).email(),
  // The length rule (12 to 128) is the use case's, so a short password gets its own message, not auth.invalid.
  password: z.string().min(1).max(1024),
  accept: z.literal('on').optional(),
});

const ConfirmInput = z.object({ code: z.string().trim().min(1).max(16) });

const signUpGuarded = guarded(SignUpInput, { kind: 'auth' }, async (input, { container, requestId }): Promise<ActionResult<null>> => {
  const signUp = createSignUp({ ...container, versions: { terms: TERMS_VERSION, privacy: PRIVACY_VERSION } });
  const result = await signUp(
    { email: input.email, password: input.password, accepted: input.accept === 'on', lang: await lang() },
    { requestId, preAuthId: await readPreAuthCookie() },
  );
  if (!result.ok) return result;
  await setPreAuthCookie(result.data.preAuthId);
  redirect('/sign-up/confirm');
});

const confirmGuarded = guarded(ConfirmInput, { kind: 'auth' }, async (input, { container, requestId }): Promise<ActionResult<null>> => {
  const result = await createConfirm(container).confirm(input, { requestId, preAuthId: await readPreAuthCookie() });
  if (!result.ok) return result;
  redirect(result.data.next);
});

const resendGuarded = guarded(z.object({}), { kind: 'auth' }, async (input, { container, requestId }) =>
  createConfirm(container).resend(input, { requestId, preAuthId: await readPreAuthCookie() }),
);

export type FormState = ActionResult<unknown> | null;

export async function signUpAction(prev: FormState, form: FormData): Promise<FormState> {
  return signUpGuarded(prev, form);
}

export async function confirmAction(prev: FormState, form: FormData): Promise<FormState> {
  return confirmGuarded(prev, form);
}

export async function resendAction(prev: FormState, form: FormData): Promise<FormState> {
  return resendGuarded(prev, form);
}
