import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { RESET_NOTICE } from '@/application/auth/reset';
import { Note } from '@/ui/primitives/Note/Note';
import styles from '../../states.module.css';
import { SignInForm } from './forms';
import own from './signIn.module.css';

// Sign in, the password step (AC-1, D-73): email and password behind the proof of work; the action goes on to the
// authenticator setup (first sign-in) or the code. The middleware sends signed-out people here with ?next=<path>; an idle
// sign-out arrives with ?reason=idle, and a step that had to start over with ?reason=expired, setup-expired or locked.
// For 10 minutes after a password reset, the HttpOnly notice cookie set by the reset action says the password was
// changed and every session ended (D-122, until SES sends the notice email).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.signIn');
  return { title: `${t('title')} · Cuenta` };
}

const REASONS: Record<string, { key: string; tone?: 'error' }> = {
  idle: { key: 'idle.banner' },
  expired: { key: 'signIn.errExpired', tone: 'error' },
  'setup-expired': { key: 'setup.errExpired', tone: 'error' },
  locked: { key: 'signIn.errLocked', tone: 'error' },
};

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const reason = REASONS[one(params.reason) ?? ''];
  const next = one(params.next);
  const changed = (await cookies()).get(RESET_NOTICE.cookie)?.value === RESET_NOTICE.value;
  const t = await getTranslations('auth');
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.brand}>cuenta</p>
        <h1 className={styles.title} tabIndex={-1}>
          {t('signIn.title')}
        </h1>
        {changed ? <Note role="status">{t('signIn.passwordChanged')}</Note> : null}
        {reason ? (
          <Note role="status" tone={reason.tone}>
            {t(reason.key)}
          </Note>
        ) : null}
        <p className={styles.lead}>{t('signIn.lead')}</p>
        <SignInForm next={next} />
        <p className={own.links}>
          <Link href="/reset">{t('signIn.forgot')}</Link>
          <span>{t('signIn.newHere')}</span>
          <Link href="/sign-up">{t('signIn.create')}</Link>
        </p>
        <p className={styles.footer}>{t('common.footer')}</p>
      </div>
    </main>
  );
}
