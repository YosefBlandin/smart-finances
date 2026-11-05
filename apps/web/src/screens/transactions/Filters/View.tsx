'use client';

import { CATEGORIES } from '@smart-finances/contracts/categories';
import { KINDS } from '@smart-finances/contracts/fields';
import { useTranslations } from 'next-intl';
import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { MonthPicker, type MonthInfo } from '@/ui/patterns/MonthPicker/MonthPicker';
import { Button } from '@/ui/primitives/Button/Button';
import { Field, SelectField } from '@/ui/primitives/Field/Field';
import { Skeleton } from '@/ui/primitives/Skeleton/Skeleton';
import { categoryName } from '../../overview/text';
import type { Address } from '../model';
import styles from '../Transactions.module.css';

// The filters (AC-6, D-82): the month, the kind and the category apply at once; the free text applies when the search
// form is sent and stays in the form, never in the page address. Kinds come from KINDS, categories from CATEGORIES.

const ALL = 'all';

// React Aria's select renders a hidden native select with a style attribute; in server HTML the content policy refuses
// it (style-src has no 'unsafe-inline'), while React sets the same style through the CSSOM in the browser. So the two
// selects render once the island has hydrated, with a skeleton in their place until then.
const noSubscribe = () => () => {};
const useHydrated = () =>
  useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

export type FiltersViewProps = {
  address: Address;
  months: MonthInfo[];
  /** The free text the list was last asked with. */
  q: string;
  onChange: (next: Address) => void;
  onSearch: (q: string) => void;
};

export function FiltersView({ address, months, q, onChange, onSearch }: FiltersViewProps) {
  const t = useTranslations();
  const [text, setText] = useState(q);
  const hydrated = useHydrated();
  const without = <K extends 'kind' | 'category'>(key: K, value: string): Address => {
    const next = { ...address };
    if (value === ALL) delete next[key];
    else next[key] = value;
    return next;
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSearch(text.trim());
  };
  return (
    <div className={styles.filters}>
      <MonthPicker months={months} value={address.month} onChange={(month) => onChange({ ...address, month })} />
      {hydrated ? (
        <>
          <SelectField
            label={t('transactions.kind')}
            value={address.kind ?? ALL}
            options={[
              { id: ALL, label: t('transactions.all') },
              ...KINDS.map((k) => ({ id: k, label: t.has(`txKinds.${k}`) ? t(`txKinds.${k}`) : k })),
            ]}
            onChange={(value) => onChange(without('kind', value))}
          />
          <SelectField
            label={t('transactions.category')}
            value={address.category ?? ALL}
            options={[
              { id: ALL, label: t('transactions.all') },
              ...[...CATEGORIES, ...(address.category && !CATEGORIES.includes(address.category) ? [address.category] : [])].map((c) => ({
                id: c,
                label: categoryName(t, c),
              })),
            ]}
            onChange={(value) => onChange(without('category', value))}
          />
        </>
      ) : (
        <>
          <Skeleton width="short" height="block" />
          <Skeleton width="short" height="block" />
        </>
      )}
      <form role="search" className={styles.search} onSubmit={submit}>
        <Field label={t('transactions.search')} type="search" name="q" value={text} onChange={setText} placeholder={t('transactions.searchPh')} />
        <Button type="submit">{t('transactions.search')}</Button>
      </form>
    </div>
  );
}
