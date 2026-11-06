import type { RatesReply, TotalsReply } from '@/queries/keys';

// The rates screen's words-free logic (SF-166): which months it lists, and a typed rate as a number.

export type RateRow = { month: string; rate?: number };

/** Months with data and months with a rate, newest first, each with its rate when it has one. */
export function rateRows(totals: TotalsReply | undefined, rates: RatesReply | undefined): RateRow[] {
  const byMonth = new Map((rates?.items ?? []).map((r) => [r.month, r.ars_per_usd]));
  const months = new Set([...(totals?.months ?? []).map((m) => m.month), ...byMonth.keys()]);
  return [...months].sort((a, b) => b.localeCompare(a)).map((month) => (byMonth.has(month) ? { month, rate: byMonth.get(month) } : { month }));
}

/** The rates reply with one month's rate set (added or replaced), in month order. */
export function withRate(reply: RatesReply, month: string, rate: number): RatesReply {
  const items = [...reply.items.filter((r) => r.month !== month), { month, ars_per_usd: rate }];
  return { ...reply, items: items.sort((a, b) => a.month.localeCompare(b.month)) };
}

/** The shown rates with one refused rate undone: that month's rate as it was before (or no rate); others as shown. */
export function undoRate(shown: RatesReply, before: RatesReply, month: string): RatesReply {
  const previous = before.items.find((r) => r.month === month);
  const items = shown.items.filter((r) => r.month !== month);
  if (previous) items.push(previous);
  return { ...shown, items: items.sort((a, b) => a.month.localeCompare(b.month)) };
}

/**
 * A rate as the person typed it, in their language's digits ("1,424.37" in English, "1.424,37" in Spanish; a bare
 * "1450.5" in either), or undefined when it is not a number above 0 with at most two decimals (the API's rule).
 */
export function parseRate(text: string, locale: 'en' | 'es'): number | undefined {
  let s = text.replace(/\s/g, '');
  if (locale === 'es' && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  const value = Number(s);
  return value > 0 ? value : undefined;
}
