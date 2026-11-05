'use server';

import { getLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSignIn, safeNext, type CodeReply, type SignInContext } from '@/application/auth/signIn';
import type { Lang } from '@/ports/identity-provider';
import { clearPreAuthCookie, readPreAuthCookie, readSessionCookie, setPreAuthCookie, setSessionCookie } from '../../cookies';
import { guarded, type ActionResult } from '../../guarded';

// The sign-in server actions (D-125): the password, the authenticator setup and the code, each through guarded() (exact
// Origin, proof of work, auth posts per address, Zod input), then the sign-in use case with the shared container. The
// page the middleware kept (?next) rides along in a hidden field and is opened only when safeNext allows it. A step that
// must start over clears __Host-pre and goes back to /sign-in with the reason; success sets a new __Host-sid.

const lang = async (): Promise<Lang> => ((await getLocale()) === 'es' ? 'es' : 'en');

const Next = z.string().max(512).optional();
const PasswordInput = z.object({ email: z.string().trim().max(254).email(), password: z.string().min(1).max(1024), next: Next });
const CodeInput = z.object({ code: z.string().trim().min(1).max(16), next: Next });

/** The next step's path, keeping a safe ?next. */
function withNext(path: string, next: string | undefined) {
  const target = safeNext(next);
  return target === '/overview' ? path : `${path}?next=${encodeURIComponent(target)}`;
}

const passwordGuarded = guarded(PasswordInput, { kind: 'auth' }, async (input, { container, requestId, ip }): Promise<ActionResult<null>> => {
  const result = await createSignIn(container).signIn(input.email, input.password, {
    requestId,
    ip,
    lang: await lang(),
    preAuthId: await readPreAuthCookie(),
  });
  if (!result.ok) return result;
  await setPreAuthCookie(result.data.preAuthId);
  redirect(result.data.next === '/sign-up/confirm' ? result.data.next : withNext(result.data.next, input.next));
});

async function after(result: CodeReply, next: string | undefined): Promise<ActionResult<null>> {
  if (!result.ok) {
    if ('restart' in result) {
      await clearPreAuthCookie();
      redirect(`/sign-in?reason=${result.restart}`);
    }
    return result;
  }
  if (!('sessionId' in result.data)) return { ok: false, messageKey: 'auth.unavailable' };
  await setSessionCookie(result.data.sessionId);
  await clearPreAuthCookie();
  redirect(safeNext(next));
}

const codeContext = async (requestId: string, ip: string | undefined): Promise<SignInContext> => ({
  requestId,
  ip,
  lang: await lang(),
  preAuthId: await readPreAuthCookie(),
  sessionId: await readSessionCookie(),
});

const setupGuarded = guarded(CodeInput, { kind: 'auth' }, async (input, { container, requestId, ip }) =>
  after(await createSignIn(container).verifySetup(input.code, await codeContext(requestId, ip)), input.next),
);

const codeGuarded = guarded(CodeInput, { kind: 'auth' }, async (input, { container, requestId, ip }) =>
  after(await createSignIn(container).verifyCode(input.code, await codeContext(requestId, ip)), input.next),
);

export type FormState = ActionResult<unknown> | null;

export async function signInAction(prev: FormState, form: FormData): Promise<FormState> {
  return passwordGuarded(prev, form);
}

export async function setupAction(prev: FormState, form: FormData): Promise<FormState> {
  return setupGuarded(prev, form);
}

export async function codeAction(prev: FormState, form: FormData): Promise<FormState> {
  return codeGuarded(prev, form);
}
