// Amount and percentage formats (D-23, D-30), through next-intl's number formatting (D-126).
// Summaries (the overview field, category rows, places) show pesos as whole numbers and dollars with cents;
// lists of single transactions keep exact cents in both currencies. Money is passed as integer cents.
import { createFormatter } from 'next-intl';

export type Lang = 'en' | 'es';

// English uses US number formats; Spanish uses Argentine ones (1.804.866,50), as the prototype does.
const INTL_LOCALE: Record<Lang, string> = { en: 'en-US', es: 'es-AR' };
const MINUS = '−';

const formatter = (lang: Lang) => createFormatter({ locale: INTL_LOCALE[lang] });

export function formatAmount(cents: number, currency: string, options: { locale: Lang; summary?: boolean; signed?: boolean }): string {
  const abs = Math.abs(cents) / 100;
  const whole = options.summary === true && currency === 'ARS';
  const digits = formatter(options.locale).number(
    whole ? Math.round(abs) : abs,
    whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  );
  const sign = cents < 0 ? MINUS : options.signed && cents > 0 ? '+' : '';
  return `${sign}${currency} ${digits}`;
}

function percent(ratio: number, lang: Lang, fractionDigits: number): string {
  const text = formatter(lang).number(ratio, { style: 'percent', minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
  return text.replace('-', MINUS);
}

/** Whole percentages for the colour field: 32%, not 31.7% (D-30). */
export const formatPercent = (ratio: number, lang: Lang): string => percent(ratio, lang, 0);

/** One decimal, for the comparison sentence, which keeps its exact points (D-30). */
export const formatPoints = (ratio: number, lang: Lang): string => percent(ratio, lang, 1);
