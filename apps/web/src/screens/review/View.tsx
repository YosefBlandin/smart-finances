'use client';

import { CATEGORIES } from '@smart-finances/contracts/categories';
import { useLocale, useTranslations } from 'next-intl';
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { formatAmount } from '@/i18n/format';
import type { ReviewReply } from '@/queries/keys';
import { DataTable } from '@/ui/patterns/DataTable/DataTable';
import { Button } from '@/ui/primitives/Button/Button';
import { SelectField } from '@/ui/primitives/Field/Field';
import { Note } from '@/ui/primitives/Note/Note';
import { LabelControl, type LabelResult, type RecipientLabel } from '../label/LabelForm';
import { categoryName, lang } from '../overview/text';
import styles from './Review.module.css';
import { ChipsPlaceholder, SuggestionChips } from './suggest/Chips';
import type { SuggestState } from './suggest/useSuggestions';

// The rows to review (SF-166; F-11): each with its date, what it is (the place, the original text as it arrived, the
// source and category), why it is here (the importer's flag and a plain reason), the exact amount (D-23) and what you
// can do. Mercado Pago rows take a category or an approval; rows of other sources are fixed in their file, so they say
// so and offer nothing (data spec PUT review: source_file_only). Imported text renders only as text (AC-9). Every row
// with a recipient key also offers Label this recipient (mercadopago-enrichment D-22).

export type ReviewRow = ReviewReply['items'][number];
export type ReviewChoice = { id: string; date: string; category?: string; approved?: true };

/** The source whose rows can be changed here (data spec PUT /transactions/{id}/review). */
export const CHOICE_SOURCE = 'mercadopago';

const INTL = { en: 'en-US', es: 'es-AR' } as const;

export type ReviewViewProps = {
  rows: ReviewRow[];
  /** A plain message after a refused choice, which was rolled back. */
  failed: boolean;
  onChoose: (choice: ReviewChoice) => void;
  /** Saves a recipient label; rows with a recipient key offer it when given. */
  onLabel?: (label: RecipientLabel) => Promise<LabelResult>;
  /** Category suggestions for payments rows (category-suggestions AC-1); without it, rows show as before. */
  suggest?: Pick<SuggestState, 'byRow' | 'settled' | 'modelPending'> & { disabled?: boolean };
};

export function ReviewView({ rows, failed, onChoose, onLabel, suggest }: ReviewViewProps) {
  const t = useTranslations();
  const locale = lang(useLocale());
  const day = new Intl.DateTimeFormat(INTL[locale], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const source = (s: string) => (t.has(`sources.names.${s}`) ? t(`sources.names.${s}`) : s);
  const reason = (flag: string) => (t.has(`review.reasons.${flag}`) ? t(`review.reasons.${flag}`) : '');
  const options = (current: string) =>
    [...CATEGORIES, ...(CATEGORIES.includes(current) ? [] : [current])].map((c) => ({ id: c, label: categoryName(t, c) }));
  // Chips above the picker; a hidden placeholder keeps their space until history settles, and on rows with no pick
  // while a model can still arrive, so nothing moves when chips appear (AC-16, D-26).
  const chips = (row: ReviewRow) => {
    if (!suggest) return null;
    if (!suggest.settled) return <ChipsPlaceholder />;
    const suggestion = suggest.byRow.get(row.id);
    if (suggestion) {
      return (
        <SuggestionChips
          suggestion={suggestion}
          disabled={suggest.disabled}
          onPick={(category) => onChoose({ id: row.id, date: row.date, category, approved: true })}
        />
      );
    }
    return suggest.modelPending ? <ChipsPlaceholder /> : null;
  };
  const keys = useRowKeys(rows, (row, n) => {
    const suggestion = suggest?.settled && !suggest.disabled ? suggest.byRow.get(row.id) : undefined;
    const category = suggestion ? [suggestion.pick, ...suggestion.others][n] : undefined;
    if (!category) return false;
    onChoose({ id: row.id, date: row.date, category, approved: true });
    return true;
  });
  const hasPayments = rows.some((row) => row.source === CHOICE_SOURCE);
  return (
    <div className={styles.screen}>
      {suggest && hasPayments ? <p className={styles.fix}>{t('review.suggest.keys')}</p> : null}
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
            <DataTable.Row key={row.id} {...(row.source === CHOICE_SOURCE ? keys.rowProps(row) : {})}>
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
                {row.source === CHOICE_SOURCE ? chips(row) : null}
                {row.source === CHOICE_SOURCE ? (
                  <div className={styles.actions}>
                    <SelectField
                      label={t('review.categorize')}
                      value={row.category}
                      options={options(row.category)}
                      onChange={(category) => {
                        if (category !== row.category) onChoose({ id: row.id, date: row.date, category });
                      }}
                    />
                    <Button size="sm" variant="primary" onClick={() => onChoose({ id: row.id, date: row.date, approved: true })}>
                      {t('review.approve')}
                    </Button>
                  </div>
                ) : (
                  <span className={styles.fix}>{t('review.fixIn', { s: source(row.source) })}</span>
                )}
                {row.recipient_key && onLabel ? (
                  <LabelControl recipientKey={row.recipient_key} name={row.merchant} category={row.category} onSave={onLabel} />
                ) : null}
              </DataTable.Cell>
            </DataTable.Row>
          ))}
        </DataTable.Body>
      </DataTable.Root>
    </div>
  );
}

const SHORTCUTS = 'Enter 1 2 3 ArrowUp ArrowDown';
const DIGITS: Record<string, number> = { '1': 0, '2': 1, '3': 2 };

/**
 * The review rows' keyboard (category-suggestions AC-10): payments rows are one roving tab stop. On the row itself
 * Enter takes the pick, 1 to 3 the chips, Up and Down move; keys inside the picker, chips or label form are left alone.
 * Repeats are ignored, and after an accept the next row takes no accept key until a keyup, so a held Enter saves one
 * row. When the focused row leaves, focus goes to the next row (or the one before), else to the page heading.
 */
function useRowKeys(rows: ReviewRow[], accept: (row: ReviewRow, n: number) => boolean) {
  const ids = rows.filter((row) => row.source === CHOICE_SOURCE).map((row) => row.id);
  const [active, setActive] = useState<string | undefined>(undefined);
  const stop = active !== undefined && ids.includes(active) ? active : ids[0];
  const elements = useRef(new Map<string, HTMLTableRowElement>());
  const focused = useRef<string | null>(null);
  const locked = useRef(false);
  const previous = useRef(ids);

  const focusRow = (id: string) => {
    setActive(id);
    elements.current.get(id)?.focus();
  };

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = ids;
    const gone = focused.current;
    if (gone === null || ids.includes(gone)) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    focused.current = null;
    const at = before.indexOf(gone);
    const next = [...before.slice(at + 1), ...before.slice(0, at).reverse()].find((id) => ids.includes(id));
    if (next) focusRow(next);
    else document.querySelector<HTMLElement>('h1')?.focus();
  });

  const rowProps = (row: ReviewRow) => ({
    tabIndex: row.id === stop ? 0 : -1,
    'aria-keyshortcuts': SHORTCUTS,
    // Focus and blur of the row element itself (they do not bubble), listened to natively; the cleanup runs on removal.
    ref: (el: HTMLTableRowElement | null) => {
      if (!el) return;
      elements.current.set(row.id, el);
      const onFocus = () => {
        focused.current = row.id;
        setActive(row.id);
      };
      // Focus that moves elsewhere clears it; a row removed from the page keeps it, so the effect can move focus on.
      const onBlur = (e: FocusEvent) => {
        if (e.relatedTarget && focused.current === row.id) focused.current = null;
      };
      el.addEventListener('focus', onFocus);
      el.addEventListener('blur', onBlur);
      return () => {
        el.removeEventListener('focus', onFocus);
        el.removeEventListener('blur', onBlur);
        if (elements.current.get(row.id) === el) elements.current.delete(row.id);
      };
    },
    onKeyUp: () => {
      locked.current = false;
    },
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
      if (e.target !== e.currentTarget || e.repeat) return;
      const i = ids.indexOf(row.id);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const to = ids[e.key === 'ArrowDown' ? Math.min(i + 1, ids.length - 1) : Math.max(i - 1, 0)];
        if (to) focusRow(to);
        return;
      }
      const n = e.key === 'Enter' ? 0 : DIGITS[e.key];
      if (n === undefined) return;
      e.preventDefault();
      if (locked.current) return;
      if (accept(row, n)) locked.current = true;
    },
  });
  return { rowProps };
}
