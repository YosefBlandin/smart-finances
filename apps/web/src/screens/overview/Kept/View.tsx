import { useLocale, useTranslations } from 'next-intl';
import { useId } from 'react';
import { formatAmount, formatPercent } from '@/i18n/format';
import { KeptBar, type KeptBarProps } from '@/ui/patterns/KeptBar/KeptBar';
import type { KeptFigures } from '../model';
import { categoryName, lang, list, monthName, summary } from '../text';
import styles from './Kept.module.css';

// The colour field (D-18, D-21, D-26 to D-31): what you kept this month against your typical month, as the overview's
// first headline. Green in a good month; ink in a bad one, and only then is the figure red (AC-11); a neutral field
// without a dollar rate. The typical month shows in the comparison sentence and at the bar's marker only (D-28).

export type KeptViewProps = { month: string; figures: KeptFigures };

const ratio = (pct: number) => pct / 100;

export function KeptView({ month, figures }: KeptViewProps) {
  const t = useTranslations();
  const locale = useLocale();
  const id = useId();
  const { model, spentUsd, top, shortTypical } = figures;
  const field = model.noRate ? 'none' : model.bad ? 'bad' : 'good';
  const ars = (cents: number) => summary(cents, 'ARS', locale);
  const usd = (cents: number) => summary(cents, 'USD', locale);
  const topName = top ? categoryName(t, top) : t('overview.everythingElse');

  // Exact points, one decimal (D-30); under one point is "about the same".
  let compare = t('overview.vsNone');
  if (model.typicalPct !== undefined) {
    const points = Math.round((model.keptPct - model.typicalPct) * 10) / 10;
    compare = Math.abs(points) < 1 ? t('overview.vsSame') : t(points > 0 ? 'overview.vsUp' : 'overview.vsDown', { n: Math.abs(points) });
  }

  let bar: KeptBarProps | null = null;
  if (!model.noRate && model.earnedArs + model.spentArs > 0) {
    if (model.bad) {
      // The track is what was spent: earnings run out at the marker, the overspend is solid at the right end.
      const over = ars(model.overArs ?? 0);
      bar = {
        field: 'bad',
        label: t('overview.splitBad', { o: over }),
        solid: (model.overArs ?? 0) / model.spentArs,
        marker: model.earnedArs / model.spentArs,
        markerLabel: t('overview.earnedOut'),
        start: { label: t('overview.barSpent'), value: formatPercent(model.earnedArs > 0 ? model.spentArs / model.earnedArs : 1, lang(locale)) },
        end: { label: '', value: t('overview.overBy', { a: over }) },
      };
    } else {
      // The track is what was earned: what you kept is solid at the right end; the marker is where a typical month's
      // spending ends.
      const spentShare = formatPercent(model.spentArs / model.earnedArs, lang(locale));
      const keptShare = formatPercent(ratio(model.keptPct), lang(locale));
      bar = {
        field: 'good',
        label: t('overview.splitGood', { s: spentShare, k: keptShare }),
        solid: ratio(model.keptPct),
        marker: model.typicalPct === undefined ? null : 1 - Math.min(1, Math.max(0, ratio(model.typicalPct))),
        markerLabel:
          model.typicalPct === undefined ? undefined : t('overview.typicalKeeps', { p: formatPercent(ratio(model.typicalPct), lang(locale)) }),
        start: { label: t('overview.barSpent'), value: spentShare },
        end: { label: t('overview.barKept'), value: keptShare },
      };
    }
  }

  const earned = model.noRate ? usd(model.earnedUsd) : ars(model.earnedArs);
  const earnedLine = model.noRate
    ? t('shell.noRateKey')
    : model.earnedUsd > 0 && model.rate !== undefined
      ? t('overview.earnedAt', { u: usd(model.earnedUsd), r: formatAmount(Math.round(model.rate * 100), 'ARS', { locale: lang(locale) }) })
      : null;
  const spentLine = spentUsd > 0 ? t(model.noRate ? 'overview.spentD' : 'overview.spentIncl', { u: usd(spentUsd) }) : null;

  return (
    <section data-section="kept" className={styles.field} data-field={field} aria-labelledby={id}>
      <div className={styles.answer}>
        <h2 id={id} className={styles.headline}>
          <span className={styles.label}>{t(model.bad && !model.noRate ? 'overview.short' : 'overview.saved')}</span>{' '}
          {model.noRate ? (
            <span className={styles.figure}>{t('overview.na')}</span>
          ) : (
            <span className={styles.figure} data-money="" data-tone={model.bad ? 'bad' : undefined}>
              {formatPercent(ratio(model.keptPct), lang(locale))}
            </span>
          )}
        </h2>
        {model.noRate ? (
          <p className={styles.say}>{t('overview.noRateSay', { m: monthName(month, locale) })}</p>
        ) : (
          <>
            {model.bad ? (
              <p className={styles.say}>
                {t.rich('overview.badSay', { n: ars(model.overArs ?? 0), top: topName, b: (chunks) => <strong>{chunks}</strong> })}
              </p>
            ) : null}
            <p className={styles.say}>{compare}</p>
          </>
        )}
        {bar ? <KeptBar {...bar} /> : null}
        {model.typicalPct !== undefined && shortTypical.length > 0 ? (
          <p className={styles.note}>
            {t('overview.typicalNote', {
              l: list(
                shortTypical.map((m) => monthName(m, locale, false)),
                locale,
              ),
            })}
          </p>
        ) : null}
      </div>
      <dl className={styles.figures}>
        <div className={styles.figureRow}>
          <dt className={styles.label}>{t('overview.earned')}</dt>
          <dd className={styles.amount}>
            <span data-money="">{earned}</span>
            {earnedLine ? <small className={styles.second}>{earnedLine}</small> : null}
          </dd>
        </div>
        <div className={styles.figureRow}>
          <dt className={styles.label}>{t('overview.spent')}</dt>
          <dd className={styles.amount}>
            <span data-money="">{ars(model.spentArs)}</span>
            {spentLine ? <small className={styles.second}>{spentLine}</small> : null}
          </dd>
        </div>
      </dl>
    </section>
  );
}
