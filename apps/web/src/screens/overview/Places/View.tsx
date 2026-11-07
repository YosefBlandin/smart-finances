import { useLocale, useTranslations } from 'next-intl';
import { useId } from 'react';
import type { Place } from '../model';
import { Section } from '../Section';
import { summary } from '../text';
import styles from './Places.module.css';

// Where you spent the most (D-18, D-19): the finding first, then the places as rows with the amount and how many times.
// Peso spending only. Place names come from imported files and render only as text (AC-9).

export function PlacesView({ places }: { places: Place[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const id = useId();
  const name = (p: Place) => p.name || t('overview.noName');
  const top = places[0];
  return (
    <Section name="places" labelledBy={id}>
      <h2 id={id} className={styles.headline}>
        {top ? t('overview.placesH', { n: name(top), a: summary(top.cents, 'ARS', locale) }) : t('overview.placesNone')}
      </h2>
      {top ? (
        <>
          <p className={styles.sub}>{t('overview.placesSub')}</p>
          <ol className={styles.list} aria-label={t('overview.topPlaces')}>
            {places.map((p) => (
              <li key={p.name} className={styles.row}>
                <span className={styles.name}>{name(p)}</span>
                <span className={styles.count}>{t('overview.placesCount', { n: p.count })}</span>
                <span className={styles.amount} data-money="">
                  {summary(p.cents, 'ARS', locale)}
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </Section>
  );
}
