'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';
import { DataTable } from '@/ui/patterns/DataTable/DataTable';
import { Button } from '@/ui/primitives/Button/Button';
import { Chip } from '@/ui/primitives/Chip/Chip';
import { Note } from '@/ui/primitives/Note/Note';
import { lang, monthName } from '../overview/text';
import { parseRate, type RateRow } from './model';
import styles from './Rates.module.css';

// One rate per month (SF-166; D-31): months with data, newest first, each with its pesos per dollar in two decimals,
// "saved" or an amber Missing (D-17: attention is amber). A rate is sent with Enter or Save; one that is not a number
// above 0 with at most two decimals is refused here, before anything is sent.

const INTL = { en: 'en-US', es: 'es-AR' } as const;

export type RatesViewProps = {
  rows: RateRow[];
  /** A plain message after a refused rate, which was rolled back. */
  failed: boolean;
  onSave: (month: string, rate: number) => void;
};

export function RatesView({ rows, failed, onSave }: RatesViewProps) {
  const t = useTranslations();
  return (
    <div className={styles.screen}>
      {failed ? (
        <Note tone="error" role="alert">
          {t('rates.saveFailed')}
        </Note>
      ) : null}
      <DataTable.Root label={t('rates.ratesTitle')}>
        <DataTable.Header>
          <DataTable.Column>{t('shell.month')}</DataTable.Column>
          <DataTable.Column>{t('rates.perDollar')}</DataTable.Column>
          <DataTable.Column>{t('rates.statusCol')}</DataTable.Column>
        </DataTable.Header>
        <DataTable.Body>
          {rows.map((row) => (
            <RateRowView key={row.month} row={row} onSave={onSave} />
          ))}
        </DataTable.Body>
      </DataTable.Root>
      <p className={styles.foot}>{t('rates.rtFoot')}</p>
    </div>
  );
}

function RateRowView({ row, onSave }: { row: RateRow; onSave: (month: string, rate: number) => void }) {
  const t = useTranslations();
  const locale = lang(useLocale());
  const errorId = useId();
  const shown =
    row.rate === undefined ? '' : new Intl.NumberFormat(INTL[locale], { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(row.rate);
  // What the person is typing; undefined shows the saved rate (so a rolled-back rate shows as it was).
  const [draft, setDraft] = useState<string>();
  const [invalid, setInvalid] = useState(false);
  const name = monthName(row.month, locale);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft === undefined) return;
    const rate = parseRate(draft, locale);
    if (rate === undefined) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft(undefined);
    if (rate !== row.rate) onSave(row.month, rate);
  };
  return (
    <DataTable.Row>
      <DataTable.Cell>
        <span className={styles.month}>{name}</span>
      </DataTable.Cell>
      <DataTable.Cell>
        <form className={styles.form} onSubmit={submit}>
          <input
            className={styles.input}
            type="text"
            inputMode="decimal"
            value={draft ?? shown}
            placeholder={t('rates.addRatePh')}
            aria-label={`${t('rates.perDollar')} · ${name}`}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            data-missing={row.rate === undefined || undefined}
            onChange={(event) => {
              setDraft(event.target.value);
              setInvalid(false);
            }}
          />
          <Button type="submit" size="sm">
            {t('rates.save')}
          </Button>
          {invalid ? (
            <p id={errorId} className={styles.error}>
              {t('rates.invalid')}
            </p>
          ) : null}
        </form>
      </DataTable.Cell>
      <DataTable.Cell>
        {row.rate === undefined ? <Chip tone="warn">{t('rates.missing')}</Chip> : <span className={styles.saved}>{t('rates.saved2')}</span>}
      </DataTable.Cell>
    </DataTable.Row>
  );
}
