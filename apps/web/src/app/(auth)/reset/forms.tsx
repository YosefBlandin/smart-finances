// The reset forms (client parts): ask for a code, the code with the new password, and "Send a new code". Each posts its
// server action with useActionState, carries a proof-of-work answer (PowField) and shows a refusal as an alert under the
// fields. No style attributes (D-57).
'use client';

// First, before PowField builds its Zod schema (see sign-in/jitless.ts).
import '../sign-in/jitless';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { PowField } from '@/ui/PowField';
import { Button } from '@/ui/primitives/Button/Button';
import { Field } from '@/ui/primitives/Field/Field';
import { Note } from '@/ui/primitives/Note/Note';
import { forgotAction, resetConfirmAction, resetResendAction, type FormState } from './actions';
import styles from './reset.module.css';

function Refusal({ state }: { state: FormState }) {
  const t = useTranslations();
  if (!state || state.ok) return null;
  const minutes = Math.max(1, Math.ceil((state.retryAfterSeconds ?? 60) / 60));
  return (
    <Note tone="error" role="alert">
      {t(state.messageKey, { minutes })}
    </Note>
  );
}

export function ForgotForm() {
  const t = useTranslations('auth');
  const [state, action, pending] = useActionState(forgotAction, null);
  return (
    <form action={action} className={styles.form}>
      <Field label={t('common.email')} name="email" type="email" autoComplete="username" inputMode="email" required />
      <PowField />
      <Refusal state={state} />
      <Button type="submit" variant="primary" busy={pending}>
        {pending ? t('reset.sending') : t('reset.submit')}
      </Button>
    </form>
  );
}

export function ResetConfirmForm() {
  const t = useTranslations('auth');
  const [state, action, pending] = useActionState(resetConfirmAction, null);
  return (
    <form action={action} className={styles.form}>
      <Field label={t('resetConfirm.code')} name="code" inputMode="numeric" autoComplete="one-time-code" required />
      <Field
        label={t('resetConfirm.newPassword')}
        name="password"
        type="password"
        autoComplete="new-password"
        hint={t('signUp.passwordHint')}
        required
      />
      <PowField />
      <Refusal state={state} />
      <Button type="submit" variant="primary" busy={pending}>
        {pending ? t('resetConfirm.saving') : t('resetConfirm.submit')}
      </Button>
    </form>
  );
}

export function ResetResendForm() {
  const t = useTranslations('auth');
  const [state, action, pending] = useActionState(resetResendAction, null);
  return (
    <form action={action} className={styles.form}>
      <PowField />
      <Refusal state={state} />
      {state?.ok ? <Note role="status">{t('resetConfirm.resent')}</Note> : null}
      <Button type="submit" busy={pending}>
        {t('resetConfirm.resend')}
      </Button>
    </form>
  );
}
