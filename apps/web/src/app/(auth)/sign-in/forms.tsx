// The sign-in, setup and code forms (client parts): each posts its server action with useActionState, carries a
// proof-of-work answer (PowField) and the kept ?next, and shows a refusal as an alert under the fields. No style
// attributes (D-57).
'use client';

// First, before PowField builds its Zod schema (see jitless.ts).
import './jitless';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { PowField } from '@/ui/PowField';
import { Button } from '@/ui/primitives/Button/Button';
import { Field } from '@/ui/primitives/Field/Field';
import { Note } from '@/ui/primitives/Note/Note';
import { codeAction, setupAction, signInAction, type FormState } from './actions';
import styles from './signIn.module.css';

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

const NextField = ({ next }: { next?: string }) => (next ? <input type="hidden" name="next" value={next} /> : null);

export function SignInForm({ next }: { next?: string }) {
  const t = useTranslations('auth');
  const [state, action, pending] = useActionState(signInAction, null);
  return (
    <form action={action} className={styles.form}>
      <Field label={t('common.email')} name="email" type="email" autoComplete="username" inputMode="email" required />
      <Field label={t('common.password')} name="password" type="password" autoComplete="current-password" required />
      <NextField next={next} />
      <PowField />
      <Refusal state={state} />
      <Button type="submit" variant="primary" busy={pending}>
        {pending ? t('signIn.signingIn') : t('signIn.submit')}
      </Button>
    </form>
  );
}

export function SetupForm({ next }: { next?: string }) {
  const t = useTranslations('auth');
  const [state, action, pending] = useActionState(setupAction, null);
  return (
    <form action={action} className={styles.form}>
      <Field label={t('common.codeDigits')} name="code" inputMode="numeric" autoComplete="one-time-code" required />
      <NextField next={next} />
      <PowField />
      <Refusal state={state} />
      <Button type="submit" variant="primary" busy={pending}>
        {pending ? t('setup.turningOn') : t('setup.submit')}
      </Button>
    </form>
  );
}

export function CodeForm({ next }: { next?: string }) {
  const t = useTranslations('auth');
  const [state, action, pending] = useActionState(codeAction, null);
  return (
    <form action={action} className={styles.form}>
      <Field label={t('common.codeDigits')} name="code" inputMode="numeric" autoComplete="one-time-code" required />
      <NextField next={next} />
      <PowField />
      <Refusal state={state} />
      <Button type="submit" variant="primary" busy={pending}>
        {pending ? t('code.checking') : t('code.submit')}
      </Button>
    </form>
  );
}
