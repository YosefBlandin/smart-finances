// MonthPicker's grid, loaded on first use (D-190): React Aria gives the popover, focus and Escape (D-141).
'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, type RefObject } from 'react';
import { Button, Dialog, Popover } from 'react-aria-components';
import { at, INTL, type MonthPickerProps } from './MonthPicker';
import styles from './MonthPicker.module.css';

export type MonthGridProps = MonthPickerProps & {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<Element | null>;
};

export default function MonthGrid({ months, value, onChange, isOpen, onOpenChange, triggerRef }: MonthGridProps) {
  const t = useTranslations();
  const locale = INTL[useLocale()] ?? 'en-US';
  const id = useId();
  const info = new Map(months.map((m) => [m.month, m]));
  const years = [...new Set(months.map((m) => Number(m.month.slice(0, 4))))].sort((a, b) => a - b);
  const short = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
  const keyId = `${id}-key`;
  const anyMissing = months.some((m) => m.hasData && !m.hasRate);

  return (
    <Popover className={styles.popover} isOpen={isOpen} onOpenChange={onOpenChange} triggerRef={triggerRef} placement="bottom start" offset={8}>
      <Dialog className={styles.grid} aria-label={t('shell.month')}>
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
                        onOpenChange(false);
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
      </Dialog>
    </Popover>
  );
}
