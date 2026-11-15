'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { Button } from '@/ui/primitives/Button/Button';
import { Note } from '@/ui/primitives/Note/Note';
import { categoryName } from '../../overview/text';
import styles from '../Review.module.css';

// Accept all (category-suggestions AC-6 to AC-8, D-25): above the list when at least one row has a pick. Its first tap
// opens an inline confirmation with the count and a per-category tally of a snapshot taken then; Save runs that
// snapshot only, Cancel closes it. While the save runs, a saving line takes focus and says how many rows (or the wait
// before a retry); after the run, a note counts the rows that did not save.

export type AcceptAllConfirm = { total: number; tally: { category: string; n: number }[] };

export type AcceptAllProps = {
  /** Rows with a pick now; the button shows only when there is at least one. */
  count: number;
  confirm?: AcceptAllConfirm;
  saving?: { n: number; waitSeconds?: number };
  failedCount: number;
  onOpen: () => void;
  onCancel: () => void;
  onSave: () => void;
};

export function AcceptAll({ count, confirm, saving, failedCount, onOpen, onCancel, onSave }: AcceptAllProps) {
  const t = useTranslations();
  const button = useRef<HTMLButtonElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const backToButton = useRef(false);
  const isSaving = Boolean(saving);

  useEffect(() => {
    if (isSaving) line.current?.focus();
  }, [isSaving]);
  useEffect(() => {
    if (!confirm && backToButton.current) {
      backToButton.current = false;
      button.current?.focus();
    }
  }, [confirm]);

  if (saving) {
    return (
      <div ref={line} tabIndex={-1} data-saving="">
        <Note role="status">
          {saving.waitSeconds !== undefined && saving.waitSeconds > 0
            ? t('review.suggest.waiting', { s: saving.waitSeconds })
            : t('review.suggest.saving', { n: saving.n })}
        </Note>
      </div>
    );
  }
  return (
    <>
      {failedCount > 0 ? (
        <Note tone="error" role="alert">
          {t('review.suggest.someFailed', { n: failedCount })}
        </Note>
      ) : null}
      {confirm ? (
        <Note title={t('review.suggest.confirmTitle')}>
          <ul className={styles.reasons}>
            {confirm.tally.map(({ category, n }) => (
              <li key={category}>{t('review.suggest.confirmLine', { n, category: categoryName(t, category) })}</li>
            ))}
          </ul>
          <div className={styles.actions}>
            <Button size="sm" variant="primary" onClick={onSave}>
              {t('review.suggest.save')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                backToButton.current = true;
                onCancel();
              }}
            >
              {t('review.suggest.cancel')}
            </Button>
          </div>
        </Note>
      ) : count > 0 ? (
        <div className={styles.actions}>
          <Button ref={button} size="sm" onClick={onOpen}>
            {t('review.suggest.acceptAll', { n: count })}
          </Button>
        </div>
      ) : null}
    </>
  );
}
