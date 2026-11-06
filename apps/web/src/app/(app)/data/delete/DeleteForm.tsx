'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button } from '@/ui/primitives/Button/Button';
import { Field } from '@/ui/primitives/Field/Field';
import { Note } from '@/ui/primitives/Note/Note';
import { DELETE_REFUSALS } from './model';
import styles from './delete.module.css';

// The delete-account form (SF-169; AC-18, D-104, D-146): what goes, the 35-day backups note, then "Confirm it's you"
// (email, password, authenticator code) and the typed word DELETE. The red Delete my account button (D-146) waits for
// DELETE. It runs startDeletion, then at once finishDeletion, which opens /goodbye when it is done; nothing is shown as
// done before the server says so (D-131). When the erase stopped it, the person is still signed in and Finish deleting
// runs finishDeletion again.

type Refused = { ok: false; messageKey: string; retryAfterSeconds?: number };
type Answer = { ok: true; data: unknown } | Refused;
export type DeleteFormProps = {
  email: string;
  start: (input: { email: string; password: string; code: string; confirm: string }) => Promise<Answer>;
  finish: (input: Record<string, never>) => Promise<Answer>;
};

type Phase = 'form' | 'working' | 'unfinished';

export function DeleteForm({ email: signedIn, start, finish }: DeleteFormProps) {
  const t = useTranslations('auth');
  const all = useTranslations();
  const [email, setEmail] = useState(signedIn);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [typed, setTyped] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refused | null>(null);

  /** The finish step; a redirect to /goodbye leaves this page, anything else is said here. */
  async function runFinish() {
    setBusy(true);
    setRefusal(null);
    let answer: Answer | undefined;
    try {
      answer = await finish({});
    } catch {
      answer = { ok: false, messageKey: DELETE_REFUSALS.unfinished };
    }
    setBusy(false);
    if (!answer || answer.ok) return;
    if (answer.messageKey === DELETE_REFUSALS.unfinished) setPhase('unfinished');
    else {
      setPhase('form');
      setRefusal(answer);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (typed !== 'DELETE' || busy) return;
    setBusy(true);
    setRefusal(null);
    let answer: Answer;
    try {
      answer = await start({ email, password, code, confirm: typed });
    } catch {
      answer = { ok: false, messageKey: 'auth.unavailable' };
    }
    if (!answer.ok) {
      setBusy(false);
      setCode('');
      setRefusal(answer);
      return;
    }
    setPhase('working');
    await runFinish();
  }

  if (phase === 'unfinished') {
    return (
      <div className={styles.screen}>
        <Note tone="error" role="alert" title={t('delete.unfinishedTitle')}>
          <p className={styles.noteText}>{t('delete.unfinished')}</p>
          <div className={styles.noteAction}>
            <Button variant="danger" busy={busy} onClick={() => void runFinish()}>
              {t('delete.finish')}
            </Button>
          </div>
        </Note>
      </div>
    );
  }

  if (phase === 'working') {
    return (
      <div className={styles.screen}>
        <div className={styles.working} role="status">
          <h2>{t('delete.workingTitle')}</h2>
          <p>{t('delete.workingPlain')}</p>
          <p className={styles.muted}>{t('delete.stay')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <div className={styles.what}>
        <ul className={styles.list}>
          <li>{t('delete.warn1')}</li>
          <li>{t('delete.warn2')}</li>
          <li>{t('delete.warn3')}</li>
        </ul>
        <Note tone="warn">{t('delete.backups')}</Note>
      </div>

      <form className={styles.form} onSubmit={(event) => void submit(event)} aria-labelledby="delete-reauth">
        <h2 id="delete-reauth">{t('delete.reauthTitle')}</h2>
        <p className={styles.muted}>{t('delete.reauthLead')}</p>
        <Field label={t('common.email')} name="email" type="email" autoComplete="username" value={email} onChange={setEmail} required />
        <Field
          label={t('common.password')}
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          required
        />
        <Field label={t('common.codeDigits')} name="code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={setCode} required />
        <Field label={t('delete.typeDelete')} name="confirm" autoComplete="off" value={typed} onChange={setTyped} required />
        {refusal ? (
          <Note tone="error" role="alert">
            {all(refusal.messageKey, { minutes: Math.max(1, Math.ceil((refusal.retryAfterSeconds ?? 60) / 60)) })}
          </Note>
        ) : null}
        <div className={styles.actions}>
          <Button type="submit" variant="danger" icon="trash" busy={busy} disabled={typed !== 'DELETE'}>
            {t('delete.submit')}
          </Button>
          <Link href="/data" className={styles.link}>
            {t('delete.exportFirst')}
          </Link>
          <Link href="/data" className={styles.link}>
            {t('common.cancel')}
          </Link>
        </div>
      </form>
    </div>
  );
}
