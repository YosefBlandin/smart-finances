import { useLocale, useTranslations } from 'next-intl';
import { formatAmount } from '@/i18n/format';
import type { Transaction } from '@/queries/keys';
import { DataTable } from '@/ui/patterns/DataTable/DataTable';
import { Button } from '@/ui/primitives/Button/Button';
import { categoryName, lang } from '../../overview/text';
import type { Address } from '../model';
import styles from '../Transactions.module.css';

// The list (AC-6, AC-9): exactly the rows the data route sent, single transactions in exact cents (D-23). Date and
// amount headers sort; the next page comes by the cursor, with a spinner only in its button (D-128). Imported text
// (place, original text) renders only as text, the original in Chivo Mono (D-16).

export type ListViewProps = {
  rows: Transaction[];
  address: Address;
  pageSize: number;
  hasNext: boolean;
  loadingNext: boolean;
  onSort: (by: Address['sort']) => void;
  onNext: () => void;
};

const INTL = { en: 'en-US', es: 'es-AR' } as const;

export function ListView({ rows, address, pageSize, hasNext, loadingNext, onSort, onNext }: ListViewProps) {
  const t = useTranslations();
  const locale = lang(useLocale());
  const day = new Intl.DateTimeFormat(INTL[locale], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const sortOf = (by: Address['sort']) => (address.sort === by ? (address.order === 'asc' ? 'ascending' : 'descending') : 'none');
  const source = (s: string) => (t.has(`sources.names.${s}`) ? t(`sources.names.${s}`) : s);
  return (
    <div className={styles.list}>
      <DataTable.Root label={t('nav.transactions')}>
        <DataTable.Header>
          <DataTable.Column sort={sortOf('date')} onSort={() => onSort('date')}>
            {t('transactions.date')}
          </DataTable.Column>
          <DataTable.Column>{t('transactions.place')}</DataTable.Column>
          <DataTable.Column>{t('transactions.original')}</DataTable.Column>
          <DataTable.Column>{t('transactions.category')}</DataTable.Column>
          <DataTable.Column>{t('transactions.source')}</DataTable.Column>
          <DataTable.Column align="end" sort={sortOf('amount')} onSort={() => onSort('amount')}>
            {t('transactions.amount')}
          </DataTable.Column>
        </DataTable.Header>
        <DataTable.Body>
          {rows.map((row) => (
            <DataTable.Row key={row.id}>
              <DataTable.Cell>
                <span className={styles.nowrap}>
                  {row.date_precision === 'month' ? t('transactions.wholeMonth') : day.format(new Date(`${row.date}T00:00:00Z`))}
                </span>
              </DataTable.Cell>
              <DataTable.Cell>{row.merchant || t('overview.noName')}</DataTable.Cell>
              <DataTable.Cell raw>{row.description_raw}</DataTable.Cell>
              <DataTable.Cell>{categoryName(t, row.category)}</DataTable.Cell>
              <DataTable.Cell>
                <span className={styles.nowrap}>{source(row.source)}</span>
              </DataTable.Cell>
              <DataTable.Cell align="end">
                <span className={styles.amount} data-money="">
                  {formatAmount(row.amount, row.currency, { locale })}
                </span>
              </DataTable.Cell>
            </DataTable.Row>
          ))}
        </DataTable.Body>
      </DataTable.Root>
      {hasNext ? (
        <div>
          <Button busy={loadingNext} onClick={onNext}>
            {t('transactions.nextPage', { n: pageSize })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
