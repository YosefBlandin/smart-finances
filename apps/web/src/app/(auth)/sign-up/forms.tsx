// The sign-up, confirm and resend forms (client parts): each posts its server action with useActionState, carries a
// proof-of-work answer (PowField), and shows a refusal as an alert under the fields. No style attributes (D-57).
'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useActionState } from 'react';
import { PowField } from '@/ui/PowField';
import { Button } from '@/ui/primitives/Button/Button';
import { Field } from '@/ui/primitives/Field/Field';
import { Note } from '@/ui/primitives/Note/Note';
import { confirmAction, resendAction, signUpAction, type FormState } from './actions';
import styles from './signUp.module.css';

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

export function SignUpForm() {
  const t = useTranslations('auth');
  const [state, action, pending] = useActionState(signUpAction, null);
  return (
    <form action={action} className={styles.form}>
      <Field label={t('common.email')} name="email" type="email" autoComplete="email" inputMode="email" required />
      <Field label={t('common.password')} name="password" type="password" autoComplete="new-password" hint={t('signUp.passwordHint')} required />
      <section className={styles.terms} aria-labelledby="sign-up-privacy">
        <h2 id="sign-up-privacy" className={styles.termsTitle}>
          {t('signUp.privacyTitle')}
        </h2>
        <p>{t('signUp.privacyBody')}</p>
        <label className={styles.check}>
          <input type="checkbox" name="accept" required />
          <span>
            {t.rich('signUp.accept', {
              privacy: (chunks) => <Link href="/privacy">{chunks}</Link>,
              terms: (chunks) => <Link href="/terms">{chunks}</Link>,
            })}
          </span>
        </label>
      </section>
      <p className={styles.small}>{t('signUp.proof')}</p>
      <PowField />
      <Refusal state={state} />
      <Button type="submit" variant="primary" busy={pending}>
        {pending ? t('signUp.creating') : t('signUp.submit')}
      </Button>
    </form>
  );
}

export function ConfirmForm() {
  const t = useTranslations('auth');
  const [state, action, pending] = useActionState(confirmAction, null);
  return (
    <form action={action} className={styles.form}>
      <Field label={t('common.codeDigits')} name="code" inputMode="numeric" autoComplete="one-time-code" required />
      <PowField />
      <Refusal state={state} />
      <Button type="submit" variant="primary" busy={pending}>
        {pending ? t('confirm.confirming') : t('confirm.submit')}
      </Button>
    </form>
  );
}

export function ResendForm() {
  const t = useTranslations('auth');
  const [state, action, pending] = useActionState(resendAction, null);
  return (
    <form action={action} className={styles.form}>
      <PowField />
      <Refusal state={state} />
      {state?.ok ? <Note role="status">{t('confirm.resent')}</Note> : null}
      <Button type="submit" busy={pending}>
        {t('confirm.resend')}
      </Button>
    </form>
  );
}
