import type { useTranslations } from 'next-intl';
import { formatAmount, type Lang } from '@/i18n/format';

// Words and formats the overview's Views share (D-23, D-30): month names in the person's language, category names from
// the catalogue (an unknown one stays as the data names it, as text), and summary amounts.

type T = ReturnType<typeof useTranslations>;

const INTL: Record<Lang, string> = { en: 'en-US', es: 'es-AR' };

export const lang = (locale: string): Lang => (locale === 'es' ? 'es' : 'en');

/** "March 2026", or "March" without the year. */
export function monthName(month: string, locale: string, withYear = true): string {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1));
  return new Intl.DateTimeFormat(INTL[lang(locale)], { month: 'long', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(date);
}

export const shortMonth = (month: string, locale: string) =>
  new Intl.DateTimeFormat(INTL[lang(locale)], { month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1)))
    .replace('.', '');

/** A list in the person's language: "March and July", "marzo y julio". */
export const list = (items: string[], locale: string) => new Intl.ListFormat(INTL[lang(locale)], { type: 'conjunction' }).format(items);

/** The category's name in the catalogue (categories.housing_utilities), else as the data names it. */
export function categoryName(t: T, name: string): string {
  const key = `categories.${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')}`;
  return t.has(key) ? t(key) : name;
}

/** A summary amount: whole pesos, dollars with cents (D-23). */
export const summary = (cents: number, currency: 'ARS' | 'USD', locale: string) =>
  formatAmount(cents, currency, { locale: lang(locale), summary: true });
