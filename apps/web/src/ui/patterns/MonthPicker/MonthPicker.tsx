// MonthPicker: a month pill that opens a grid, years down and twelve months across (overview "Page frame").
// React Aria gives the popover, focus and Escape (D-141). The chosen month is aria-current="date", months without data
// are disabled, and months without a dollar rate carry an amber mark explained by one key line.
'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Button, Dialog, DialogTrigger, Popover } from 'react-aria-components';
import { Icon } from '../../primitives/Icon/Icon';
import styles from './MonthPicker.module.css';

export type MonthInfo = { month: string; hasData: boolean; hasRate: boolean };

export type MonthPickerProps = {
  /** The months that exist, as YYYY-MM. Years with none are not shown. */
  months: MonthInfo[];
  value: string;
  onChange: (month: string) => void;
};

const INTL: Record<string, string> = { en: 'en-US', es: 'es-AR' };
const at = (year: number, index: number) => new Date(Date.UTC(year, index, 1));

export function MonthPicker({ months, value, onChange }: MonthPickerProps) {
  const t = useTranslations();
  const locale = INTL[useLocale()] ?? 'en-US';
  const id = useId();
  const [open, setOpen] = useState(false);
  const info = new Map(months.map((m) => [m.month, m]));
  const years = [...new Set(months.map((m) => Number(m.month.slice(0, 4))))].sort((a, b) => a - b);
  const short = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
  const long = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const [year, month] = value.split('-').map(Number);
  const current = long.format(at(year ?? 1970, (month ?? 1) - 1));
  const keyId = `${id}-key`;
  const anyMissing = months.some((m) => m.hasData && !m.hasRate);

  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button className={styles.trigger}>
        <Icon name="calendar" />
        <span className={styles.current}>{current}</span>
        <Icon name="chevronDown" />
      </Button>
      <Popover className={styles.popover} placement="bottom start" offset={8}>
        <Dialog className={styles.grid} aria-label={t('shell.month')}>
          {({ close }) => (
            <>
              {years.map((y) => (
                <div key={y} className={styles.year} role="group" aria-labelledby={`${id}-${y}`}>
                  <span id={`${id}-${y}`} className={styles.yearLabel}>
                    {y}
                  </span>
                  <div className={styles.cells}>
                    {Array.from({ length: 12 }, (_, i) => {
                      const key = `${y}-${String(i + 1).padStart(2, '0')}`;
                      const m = info.get(key);
                      const missing = Boolean(m?.hasData && !m.hasRate);
                      return (
                        <Button
                          key={key}
                          className={styles.cell}
                          isDisabled={!m?.hasData}
                          aria-label={`${short.format(at(y, i))} ${y}`.replace('.', '')}
                          aria-current={key === value ? 'date' : undefined}
                          aria-describedby={missing ? keyId : undefined}
                          data-missing={missing || undefined}
                          onPress={() => {
                            onChange(key);
                            close();
                          }}
                        >
                          {short.format(at(y, i)).replace('.', '')}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {anyMissing ? (
                <p id={keyId} className={styles.key}>
                  <span className={styles.dot} aria-hidden="true" />
                  {t('shell.noRateKey')}
                </p>
              ) : null}
            </>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
