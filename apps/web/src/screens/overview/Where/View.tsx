import { useLocale, useTranslations } from 'next-intl';
import { useId } from 'react';
import { formatPercent } from '@/i18n/format';
import { BandStrip } from '@/ui/patterns/BandStrip/BandStrip';
import { CategoryRow } from '@/ui/patterns/CategoryRow/CategoryRow';
import type { WhereFigures } from '../model';
import { Section } from '../Section';
import { categoryName, lang, summary } from '../text';
import styles from '../Overview.module.css';

// Where it went (D-18, D-19): the finding first, then spending against the typical month in dollars (so peso inflation
// does not make every month look worse), the band strip as the header and the categories under it (D-15, D-25, D-34).

/** Shares within this of the typical month read as "about the same". */
const SAME = 0.05;

export function WhereView({ figures }: { figures: WhereFigures }) {
  const t = useTranslations();
  const locale = useLocale();
  const id = useId();
  const named = figures.slices.map((s) => ({ ...s, label: s.name ? categoryName(t, s.name) : t('overview.everythingElse') }));
  const [a, b] = named.filter((s) => s.name);

  let headline = t('overview.whereNone');
  if (a && b) headline = t('overview.whereTwo', { a: a.label, b: b.label, k: Math.round((a.share + b.share) * 10), u: t('overview.pesos') });
  else if (a) headline = t('overview.whereOne', { a: a.label, p: formatPercent(a.share, lang(locale)) });

  let compare: string | null = null;
  if (figures.vsTypical !== undefined) {
    const p = formatPercent(Math.abs(figures.vsTypical), lang(locale));
    compare =
      Math.abs(figures.vsTypical) < SAME ? t('overview.spendSame') : t(figures.vsTypical > 0 ? 'overview.spendMore' : 'overview.spendLess', { p });
  }

  return (
    <Section name="where" labelledBy={id}>
      <h2 id={id} className={styles.headline}>
        {headline}
      </h2>
      {compare ? <p className={styles.sub}>{compare}</p> : null}
      {figures.totalCents > 0 ? (
        <>
          <BandStrip label={t('overview.stripLabel')} bands={named.map((s) => ({ cat: s.cat, share: s.share, name: s.label }))} />
          <CategoryRow.List label={t('overview.byCat')}>
            {named.map((s) => (
              <CategoryRow
                key={s.name || 'else'}
                cat={s.cat}
                name={s.label}
                amount={summary(s.cents, 'ARS', locale)}
                share={formatPercent(s.share, lang(locale))}
              />
            ))}
          </CategoryRow.List>
        </>
      ) : null}
      {figures.usdNoRate > 0 ? (
        <p className={styles.sub}>
          {t('overview.alsoUsd')} <span data-money="">{summary(figures.usdNoRate, 'USD', locale)}</span>
        </p>
      ) : null}
    </Section>
  );
}
