// The consent screen's forms and the "session ended" form (client parts): each posts its server action with
// useActionState and carries a proof-of-work answer (PowField); a refusal shows as an alert. No style attributes (D-57).
'use client';

// First, before PowField builds its Zod schema (see jitless.ts).
import '../(auth)/sign-in/jitless';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useActionState } from 'react';
import { PowField } from '@/ui/PowField';
import { Button } from '@/ui/primitives/Button/Button';
import { Note } from '@/ui/primitives/Note/Note';
import { acceptConsentAction, declineConsentAction, leaveAction, type FormState } from './actions';
import styles from './consent.module.css';

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

/** Accept the versions this screen shows; the server records them only while they are current (D-145). */
export function ConsentForm({ terms, privacy }: { terms: string; privacy: string }) {
  const t = useTranslations('auth.consent');
  const [state, action, pending] = useActionState(acceptConsentAction, null);
  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="terms" value={terms} />
      <input type="hidden" name="privacy" value={privacy} />
      <label className={styles.check}>
        <input type="checkbox" name="accept" required />
        <span>
          {t.rich('accept', {
            privacy: (chunks) => <Link href="/privacy">{chunks}</Link>,
            terms: (chunks) => <Link href="/terms">{chunks}</Link>,
          })}
        </span>
      </label>
      <p className={styles.small}>{t('record')}</p>
      <PowField />
      <Refusal state={state} />
      <Button type="submit" variant="primary" busy={pending}>
        {pending ? t('saving') : t('submit')}
      </Button>
    </form>
  );
}

/** Refusing signs out. */
export function DeclineForm() {
  const t = useTranslations('auth.consent');
  const [state, action, pending] = useActionState(declineConsentAction, null);
  return (
    <form action={action} className={styles.form}>
      <PowField />
      <Refusal state={state} />
      <Button type="submit" busy={pending}>
        {pending ? t('declining') : t('decline')}
      </Button>
    </form>
  );
}

/** Clears the ended session's cookie and goes to sign-in, keeping this page for after it. */
export function LeaveForm({ idle }: { idle: boolean }) {
  const t = useTranslations('auth.ended');
  const pathname = usePathname();
  const [state, action, pending] = useActionState(leaveAction, null);
  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="next" value={pathname} />
      {idle ? <input type="hidden" name="reason" value="idle" /> : null}
      <PowField />
      <Refusal state={state} />
      <Button type="submit" variant="primary" busy={pending}>
        {pending ? t('leaving') : t('submit')}
      </Button>
    </form>
  );
}
