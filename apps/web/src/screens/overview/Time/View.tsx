import { useLocale, useTranslations } from 'next-intl';
import { useId } from 'react';
import { formatPercent } from '@/i18n/format';
import { DataTable } from '@/ui/patterns/DataTable/DataTable';
import type { TimeFigures } from '../model';
import { Section } from '../Section';
import { lang, list, monthName, shortMonth } from '../text';
import styles from './Time.module.css';
import overview from '../Overview.module.css';

// How you are doing over time (D-18, D-19): the finding first, then the kept share of each month as hand-drawn SVG
// columns with the typical month as a dashed line, and the same numbers as a table (D-57). Months without a dollar rate
// are marked with a dotted outline, never drawn as zero. Geometry is SVG attributes only (no style attributes, SF-107).

const W = 640;
const H = 200;
const GUTTER = 76; // room for the typical line's label, so it never sits on a column
const TOP = 12;
const BOTTOM = 24;

export function TimeView({ figures }: { figures: TimeFigures }) {
  const t = useTranslations();
  const locale = useLocale();
  const id = useId();
  const { points, typicalPct } = figures;
  const rated = points.filter((p) => !p.noRate);
  const short = rated.filter((p) => (p.keptPct ?? 0) <= 0).map((p) => monthName(p.month, locale, false));

  let headline = t('overview.timeNone');
  if (rated.length > 0) {
    headline =
      short.length === 0
        ? t('overview.timeAll', { m: rated.length })
        : `${t('overview.timeSome', { k: rated.length - short.length, m: rated.length })} ${
            short.length === 1 ? t('overview.timeExc', { m: short[0]! }) : t('overview.timeShort', { l: list(short, locale) })
          }`;
  }

  const values = [0, ...rated.map((p) => p.keptPct ?? 0), ...(typicalPct === undefined ? [] : [typicalPct])];
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  const span = hi - lo || 1;
  const plot = H - TOP - BOTTOM;
  const y = (v: number) => TOP + ((hi - v) / span) * plot;
  const slot = (W - GUTTER) / Math.max(1, points.length);
  const width = slot * 0.6;
  const pct = (v: number) => formatPercent(v / 100, lang(locale));

  return (
    <Section name="time" labelledBy={id}>
      <h2 id={id} className={overview.headline}>
        {headline}
      </h2>
      <p className={overview.sub}>
        {t('overview.savingsTitle')} · {t('overview.savingsSub')}
      </p>
      {rated.length > 0 ? (
        <>
          <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${t('overview.savingsTitle')}, ${t('overview.last12')}`}>
            <line className={styles.zero} x1="0" x2={W - GUTTER} y1={y(0)} y2={y(0)} />
            {points.map((p, i) => {
              const x = i * slot + (slot - width) / 2;
              const label = (
                <text className={styles.month} x={x + width / 2} y={H - 6} textAnchor="middle">
                  {shortMonth(p.month, locale)}
                </text>
              );
              if (p.noRate) {
                return (
                  <g key={p.month}>
                    <rect className={styles.noRate} x={x} y={TOP} width={width} height={plot} rx="2" />
                    {label}
                  </g>
                );
              }
              const v = p.keptPct ?? 0;
              return (
                <g key={p.month}>
                  <rect
                    className={styles.column}
                    data-short={v <= 0 || undefined}
                    x={x}
                    y={Math.min(y(v), y(0))}
                    width={width}
                    height={Math.max(1, Math.abs(y(v) - y(0)))}
                    rx="2"
                  />
                  {label}
                </g>
              );
            })}
            {typicalPct !== undefined ? (
              <>
                <line className={styles.typical} x1="0" x2={W - GUTTER} y1={y(typicalPct)} y2={y(typicalPct)} />
                <text className={styles.month} x={W - GUTTER + 8} y={y(typicalPct) + 4}>
                  {t('overview.typicalShort')} {pct(typicalPct)}
                </text>
              </>
            ) : null}
          </svg>
          {typicalPct !== undefined ? <p className={overview.sub}>{t('overview.dotted')}</p> : null}
          <details className={styles.table}>
            <summary className={styles.summary}>{t('overview.asTable')}</summary>
            <DataTable.Root label={t('overview.savingsTitle')}>
              <DataTable.Header>
                <DataTable.Column>{t('shell.month')}</DataTable.Column>
                <DataTable.Column align="end">{t('overview.saved')}</DataTable.Column>
              </DataTable.Header>
              <DataTable.Body>
                {points.map((p) => (
                  <DataTable.Row key={p.month}>
                    <DataTable.Cell>{monthName(p.month, locale)}</DataTable.Cell>
                    <DataTable.Cell align="end">{p.noRate ? t('overview.noRate') : pct(p.keptPct ?? 0)}</DataTable.Cell>
                  </DataTable.Row>
                ))}
              </DataTable.Body>
            </DataTable.Root>
          </details>
        </>
      ) : null}
    </Section>
  );
}
