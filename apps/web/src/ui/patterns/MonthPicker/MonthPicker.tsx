// MonthPicker: a month pill that opens a grid, years down and twelve months across (overview "Page frame").
// React Aria gives the popover, focus and Escape (D-141); the pill is a plain button, and the grid with React Aria loads
// on first use, so no page's first load carries it (D-190, T-WEB-17). The chosen month is aria-current="date", months
// without data are disabled, and months without a dollar rate carry an amber mark explained by one key line.
'use client';

import { useLocale } from 'next-intl';
import { lazy, Suspense, useRef, useState } from 'react';
import { Icon } from '../../primitives/Icon/Icon';
import styles from './MonthPicker.module.css';

export type MonthInfo = { month: string; hasData: boolean; hasRate: boolean };

export type MonthPickerProps = {
  /** The months that exist, as YYYY-MM. Years with none are not shown. */
  months: MonthInfo[];
  value: string;
  onChange: (month: string) => void;
};

export const INTL: Record<string, string> = { en: 'en-US', es: 'es-AR' };
export const at = (year: number, index: number) => new Date(Date.UTC(year, index, 1));

const load = () => import('./MonthGrid');
const MonthGrid = lazy(load);

export function MonthPicker({ months, value, onChange }: MonthPickerProps) {
  const locale = INTL[useLocale()] ?? 'en-US';
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // The grid is mounted from the first press on, and stays mounted.
  const [used, setUsed] = useState(false);
  const long = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const [year, month] = value.split('-').map(Number);
  const current = long.format(at(year ?? 1970, (month ?? 1) - 1));

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerEnter={() => void load()}
        onFocus={() => void load()}
        onClick={() => {
          // Safari and Firefox do not focus a button on click; React Aria gives focus back to it on close.
          trigger.current?.focus();
          setUsed(true);
          setOpen(true);
        }}
      >
        <Icon name="calendar" />
        <span className={styles.current}>{current}</span>
        <Icon name="chevronDown" />
      </button>
      {used ? (
        <Suspense fallback={null}>
          <MonthGrid months={months} value={value} onChange={onChange} isOpen={open} onOpenChange={setOpen} triggerRef={trigger} />
        </Suspense>
      ) : null}
    </>
  );
}
