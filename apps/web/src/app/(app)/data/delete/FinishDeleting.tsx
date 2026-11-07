'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/ui/primitives/Button/Button';
import { Note } from '@/ui/primitives/Note/Note';
import { DELETE_REFUSALS } from './model';

// The Finish deleting button of the money layout's deleting screen (SF-169; AC-18, architecture "States and exits",
// deleting account): it runs finishDeletion, which opens /goodbye when it is done, as the delete page's own Finish
// deleting does. Nothing is shown as done before the server says so (D-131); a refusal is said here.

type Answer = { ok: true; data: unknown } | { ok: false; messageKey: string };

export function FinishDeleting({ finish }: { finish: (input: Record<string, never>) => Promise<Answer> }) {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setRefusal(null);
    let answer: Answer | undefined;
    try {
      answer = await finish({});
    } catch {
      answer = { ok: false, messageKey: DELETE_REFUSALS.unfinished };
    }
    setBusy(false);
    if (answer && !answer.ok) setRefusal(answer.messageKey);
  }

  return (
    <>
      {refusal ? (
        <Note tone="error" role="alert">
          {t(refusal)}
        </Note>
      ) : null}
      <div>
        <Button variant="danger" busy={busy} onClick={() => void run()}>
          {t('auth.delete.finish')}
        </Button>
      </div>
    </>
  );
}
