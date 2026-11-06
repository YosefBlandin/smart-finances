'use client';

import { CATEGORIES } from '@smart-finances/contracts/categories';
import { useLocale, useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';
import { formatAmount } from '@/i18n/format';
import type { ReviewReply } from '@/queries/keys';
import { DataTable } from '@/ui/patterns/DataTable/DataTable';
import { Button } from '@/ui/primitives/Button/Button';
import { SelectField } from '@/ui/primitives/Field/Field';
import { Note } from '@/ui/primitives/Note/Note';
import { Skeleton } from '@/ui/primitives/Skeleton/Skeleton';
import { categoryName, lang } from '../overview/text';
import styles from './Review.module.css';

// The rows to review (SF-166; F-11): each with its date, what it is (the place, the original text as it arrived, the
// source and category), why it is here (the importer's flag and a plain reason), the exact amount (D-23) and what you
// can do. Mercado Pago rows take a category or an approval; rows of other sources are fixed in their file, so they say
// so and offer nothing (data spec PUT review: source_file_only). Imported text renders only as text (AC-9).

export type ReviewRow = ReviewReply['items'][number];
export type ReviewChoice = { id: string; date: string; category?: string; approved?: true };

/** The source whose rows can be changed here (data spec PUT /transactions/{id}/review). */
export const CHOICE_SOURCE = 'mercadopago';

const INTL = { en: 'en-US', es: 'es-AR' } as const;

// React Aria's select renders a hidden native select with a style attribute, which the content policy refuses in
// server HTML; the selects render after hydration with a skeleton until then (SF-165's workaround; SF-171 fixes Field).
const noSubscribe = () => () => {};
const useHydrated = () =>
  useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

export type ReviewViewProps = {
  rows: ReviewRow[];
  /** A plain message after a refused choice, which was rolled back. */
  failed: boolean;
  onChoose: (choice: ReviewChoice) => void;
};

export function ReviewView({ rows, failed, onChoose }: ReviewViewProps) {
  const t = useTranslations();
  const locale = lang(useLocale());
  const hydrated = useHydrated();
  const day = new Intl.DateTimeFormat(INTL[locale], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const source = (s: string) => (t.has(`sources.names.${s}`) ? t(`sources.names.${s}`) : s);
  const reason = (flag: string) => (t.has(`review.reasons.${flag}`) ? t(`review.reasons.${flag}`) : '');
  const options = (current: string) =>
    [...CATEGORIES, ...(CATEGORIES.includes(current) ? [] : [current])].map((c) => ({ id: c, label: categoryName(t, c) }));
  return (
    <div className={styles.screen}>
      {failed ? (
        <Note tone="error" role="alert">
          {t('review.saveFailed')}
        </Note>
      ) : null}
      <DataTable.Root label={t('nav.review')}>
        <DataTable.Header>
          <DataTable.Column>{t('transactions.date')}</DataTable.Column>
          <DataTable.Column>{t('review.what')}</DataTable.Column>
          <DataTable.Column>{t('review.why')}</DataTable.Column>
          <DataTable.Column align="end">{t('transactions.amount')}</DataTable.Column>
          <DataTable.Column>{t('review.action')}</DataTable.Column>
        </DataTable.Header>
        <DataTable.Body>
          {rows.map((row) => (
            <DataTable.Row key={row.id}>
              <DataTable.Cell>
                <span className={styles.nowrap}>
                  {row.date_precision === 'month' ? t('transactions.wholeMonth') : day.format(new Date(`${row.date}T00:00:00Z`))}
                </span>
              </DataTable.Cell>
              <DataTable.Cell>
                <div className={styles.what}>
                  <span>{row.merchant || t('overview.noName')}</span>
                  <span className={styles.raw}>{row.description_raw}</span>
                  <span className={styles.meta}>
                    {source(row.source)} · {categoryName(t, row.category)}
                  </span>
                </div>
              </DataTable.Cell>
              <DataTable.Cell>
                <div className={styles.reasons}>
                  {row.reasons.map((flag) => (
                    <div key={flag} className={styles.reason}>
                      <span className={styles.flag}>{flag}</span>
                      <span className={styles.why}>{reason(flag)}</span>
                    </div>
                  ))}
                </div>
              </DataTable.Cell>
              <DataTable.Cell align="end">
                <span className={styles.amount} data-money="">
                  {formatAmount(row.amount, row.currency, { locale })}
                </span>
              </DataTable.Cell>
              <DataTable.Cell>
                {row.source === CHOICE_SOURCE ? (
                  <div className={styles.actions}>
                    {hydrated ? (
                      <SelectField
                        label={t('review.categorize')}
                        value={row.category}
                        options={options(row.category)}
                        onChange={(category) => {
                          if (category !== row.category) onChoose({ id: row.id, date: row.date, category });
                        }}
                      />
                    ) : (
                      <Skeleton width="short" height="block" />
                    )}
                    <Button size="sm" variant="primary" onClick={() => onChoose({ id: row.id, date: row.date, approved: true })}>
                      {t('review.approve')}
                    </Button>
                  </div>
                ) : (
                  <span className={styles.fix}>{t('review.fixIn', { s: source(row.source) })}</span>
                )}
              </DataTable.Cell>
            </DataTable.Row>
          ))}
        </DataTable.Body>
      </DataTable.Root>
    </div>
  );
}
