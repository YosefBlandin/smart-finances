import { getTranslations } from 'next-intl/server';
import type { SignedOutWhy } from '@/application/guard';
import { Note } from '@/ui/primitives/Note/Note';
import states from '../states.module.css';
import { LeaveForm } from './forms';

// The "session ended" screen: the money layout and the consent screen show it in place when __Host-sid names no live
// session (idle 30 minutes, 12 hours, a refused refresh, a sign-out elsewhere) or an account being deleted. A redirect
// to /sign-in cannot work while the stale cookie is there (the middleware sends auth routes back to the overview, and a
// server component cannot clear a cookie), so the button posts leaveAction, which clears it and opens sign-in with the
// page kept (D-72 "signed out, path kept").
export async function Ended({ why }: { why?: SignedOutWhy }) {
  const t = await getTranslations('auth');
  const idle = why === 'idle';
  return (
    <main className={states.page}>
      <div className={states.card}>
        <p className={states.brand}>cuenta</p>
        <h1 className={states.title} tabIndex={-1}>
          {t('ended.title')}
        </h1>
        {idle ? <Note role="status">{t('idle.banner')}</Note> : <p className={states.lead}>{t('ended.lead')}</p>}
        <LeaveForm idle={idle} />
      </div>
    </main>
  );
}
