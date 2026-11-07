import { arsCents, overviewModel, TYPICAL_MAX, TYPICAL_MIN, type OverviewModel } from '@/domain/money';
import type { ImportsPage, RatesReply, ReviewReply, TotalsRange, TotalsReply, Transaction, TransactionFilters } from '@/queries/keys';
import { CATEGORY_COLOURS, type CategoryColour } from '@/ui/primitives/CategorySquare/CategorySquare';

// What the overview's sections show, worked out from the data replies (SF-164). Pure: the server page uses it to pick
// the month and the reads, and the section Containers to turn the cached replies into View props. Money is integer cents;
// dollars count in pesos only at their month's rate (D-31); percentages stay exact for the Views to round (D-30).

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** yyyy-mm plus n months (n may be negative). */
export function addMonths(month: string, n: number): string {
  const i = Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1 + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/** The UTC month of an epoch-millisecond time. */
export const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);

/**
 * The months the overview's one totals read covers: three years up to this month, so picking another month asks for
 * nothing new (only its places), and always the 11 months before the shown one (the chart and the typical month).
 */
export function totalsRange(asked: string | undefined, now: string): TotalsRange {
  const to = asked && asked > now ? asked : now;
  const threeYears = addMonths(now, -35);
  const chart = asked ? addMonths(asked, -11) : threeYears;
  return { from: chart < threeYears ? chart : threeYears, to, view: 'native' };
}

/** The month to show: the one asked for, else the latest month with data, else this month. */
export function shownMonth(asked: string | undefined, totals: TotalsReply | undefined, now: string): string {
  if (asked) return asked;
  const months = (totals?.months ?? []).map((m) => m.month).filter((m) => m <= now);
  return months.length ? months.sort().at(-1)! : now;
}

/** The places read: the month's expenses, biggest first, one page of 200. */
export const placesFilters = (month: string): TransactionFilters => ({ month, kind: 'expense', sort: 'amount', order: 'asc', limit: 200 });

type Totals = TotalsReply['months'][number]['totals'];
const rateMap = (rates: RatesReply) => new Map(rates.items.map((r) => [r.month, r.ars_per_usd]));

/** One kind's cents by category, dollars in pesos at the rate (left out without one); money out turns positive. */
function byCategory(totals: Totals | undefined, kind: string, rate: number | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const [category, byCurrency] of Object.entries(totals?.[kind] ?? {})) {
    const ars = (byCurrency.ARS ?? 0) + (rate === undefined ? 0 : arsCents(byCurrency.USD ?? 0, rate));
    if (ars !== 0) out.set(category, Math.abs(ars));
  }
  return out;
}

const sumKind = (totals: Totals | undefined, kind: string, currency: string) =>
  Object.values(totals?.[kind] ?? {}).reduce((sum, byCurrency) => sum + (byCurrency[currency] ?? 0), 0);

/** The earlier months the typical month averages, as domain/money.ts picks them: up to 6 latest with totals and a rate. */
function typicalMonths(month: string, totals: TotalsReply, rates: Map<string, number>): string[] {
  return totals.months
    .map((m) => m.month)
    .filter((m) => m < month && rates.has(m))
    .sort()
    .slice(-TYPICAL_MAX);
}

// ---- the colour field ----

export type KeptFigures = {
  model: OverviewModel;
  /** Dollars spent, in cents (positive): the second line under Spent. */
  spentUsd: number;
  /** The biggest spending category, for the bad-month sentence. */
  top?: string;
  /** Typical months that came up short, oldest first (D-28's one short line under the bar). */
  shortTypical: string[];
};

export function keptFigures(month: string, totals: TotalsReply, ratesReply: RatesReply): KeptFigures {
  const rates = rateMap(ratesReply);
  const model = overviewModel(month, totals.months, ratesReply.items);
  const current = totals.months.find((m) => m.month === month)?.totals;
  const typical = model.typicalPct === undefined ? [] : typicalMonths(month, totals, rates);
  return {
    model,
    spentUsd: Math.abs(sumKind(current, 'expense', 'USD')),
    top: categories(month, totals, ratesReply).slices[0]?.name,
    shortTypical: typical.filter((m) => overviewModel(m, totals.months, ratesReply.items).bad),
  };
}

// ---- where it went ----

export type Slice = { name: string; cents: number; share: number; cat: CategoryColour };
export type WhereFigures = {
  /** Up to six coloured categories, biggest first, then "Everything else" (name ''). */
  slices: Slice[];
  totalCents: number;
  /** Dollars spent when the month has no rate (they are not in the pesos). */
  usdNoRate: number;
  /** Dollar spending against the typical month's, as a ratio minus one; absent without a rate or enough history. */
  vsTypical?: number;
};

const COLOURED = CATEGORY_COLOURS.filter((c): c is Exclude<CategoryColour, 'other'> => c !== 'other');
const SHOWN = 6;

/** Each category keeps one colour: by size over every month read, the eleven biggest coloured, the rest grey (D-25). */
function colours(totals: TotalsReply, rates: Map<string, number>): Map<string, CategoryColour> {
  const all = new Map<string, number>();
  for (const m of totals.months) for (const [c, v] of byCategory(m.totals, 'expense', rates.get(m.month))) all.set(c, (all.get(c) ?? 0) + v);
  const order = [...all].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
  return new Map(order.map((c, i) => [c, COLOURED[i] ?? 'other']));
}

/** Dollars spent in a month, in cents: pesos at its rate plus dollars. */
function spentUsdCents(totals: Totals | undefined, rate: number): number {
  return Math.abs(sumKind(totals, 'expense', 'ARS')) / rate + Math.abs(sumKind(totals, 'expense', 'USD'));
}

export function categories(month: string, totals: TotalsReply, ratesReply: RatesReply): WhereFigures {
  const rates = rateMap(ratesReply);
  const rate = rates.get(month);
  const current = totals.months.find((m) => m.month === month)?.totals;
  const spent = [...byCategory(current, 'expense', rate)].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const totalCents = spent.reduce((sum, [, v]) => sum + v, 0);
  const colourOf = colours(totals, rates);
  const slices: Slice[] = [];
  let rest = 0;
  for (const [name, cents] of spent) {
    const cat = colourOf.get(name) ?? 'other';
    if (cat !== 'other' && slices.length < SHOWN) slices.push({ name, cents, share: cents / totalCents, cat });
    else rest += cents;
  }
  if (rest > 0) slices.push({ name: '', cents: rest, share: rest / totalCents, cat: 'other' });

  let vsTypical: number | undefined;
  const typical = typicalMonths(month, totals, rates);
  if (rate !== undefined && typical.length >= TYPICAL_MIN) {
    const usual =
      typical.reduce((sum, m) => sum + spentUsdCents(totals.months.find((t) => t.month === m)?.totals, rates.get(m)!), 0) / typical.length;
    if (usual > 0) vsTypical = spentUsdCents(current, rate) / usual - 1;
  }
  return {
    slices,
    totalCents,
    usdNoRate: rate === undefined ? Math.abs(sumKind(current, 'expense', 'USD')) : 0,
    ...(vsTypical === undefined ? {} : { vsTypical }),
  };
}

// ---- over time ----

export type TimePoint = { month: string; keptPct?: number; noRate: boolean };
export type TimeFigures = { points: TimePoint[]; typicalPct?: number };

/** The shown month and the 11 before it that have data: the kept share of each, or no rate. */
export function overTime(month: string, totals: TotalsReply, ratesReply: RatesReply): TimeFigures {
  const first = addMonths(month, -11);
  const points = totals.months
    .map((m) => m.month)
    .filter((m) => m >= first && m <= month)
    .sort()
    .map((m): TimePoint => {
      const model = overviewModel(m, totals.months, ratesReply.items);
      return model.noRate ? { month: m, noRate: true } : { month: m, keptPct: model.keptPct, noRate: false };
    });
  const { typicalPct } = overviewModel(month, totals.months, ratesReply.items);
  return { points, ...(typicalPct === undefined ? {} : { typicalPct }) };
}

// ---- places ----

export type Place = { name: string; cents: number; count: number };

/** Where the most pesos went this month: expenses by place, biggest first (peso spending only). */
export function places(items: readonly Transaction[], limit = 5): Place[] {
  const by = new Map<string, Place>();
  for (const t of items) {
    if (t.kind !== 'expense' || t.currency !== 'ARS') continue;
    const name = t.merchant.trim();
    const place = by.get(name) ?? { name, cents: 0, count: 0 };
    place.cents += Math.abs(t.amount);
    place.count += 1;
    by.set(name, place);
  }
  return [...by.values()].sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name)).slice(0, limit);
}

// ---- what is waiting ----

/** Imports that need a look: failed, stalled or never arrived. */
const LOOK = new Set(['failed', 'stalled', 'expired']);

export type Waiting = { missingRate: boolean; review: number; imports: number };

export function waiting(month: string, review: ReviewReply, imports: ImportsPage, totals?: TotalsReply, rates?: RatesReply): Waiting {
  const hasData = totals?.months.some((m) => m.month === month) ?? false;
  const missingRate = hasData && (rates ? !rates.items.some((r) => r.month === month) : (totals?.missing_rates.includes(month) ?? false));
  return { missingRate, review: review.items.length, imports: imports.items.filter((i) => LOOK.has(i.status)).length };
}
