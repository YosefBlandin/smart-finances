// The overview's money model (AC-2, AC-11; D-20, D-85, D-26 to D-31). Pure: the month totals and the rates come in as
// the data API sends them (GET /totals in the native view: kind, then category, then currency, to integer cents; GET
// /rates: pesos per dollar with two decimals). All amounts out are integer peso cents. Earned is kind income only and
// spent is kind expense only (data spec "HTTP routes", Totals); money out is negative in the totals, so spent is the
// expense sum with its sign turned. Only ARS and USD are counted. Percentages are exact; screens round them (D-30).

export type MonthTotals = { month: string; totals: Record<string, Record<string, Record<string, number>>> };
export type Rate = { month: string; ars_per_usd: number };

export type OverviewModel = {
  /** Pesos earned, the month's dollars converted at its rate (left out when it has none). */
  earnedArs: number;
  /** Dollars actually received, in cents: the second line under Earned (D-31). */
  earnedUsd: number;
  spentArs: number;
  /** earnedArs - spentArs; negative in a bad month. */
  keptArs: number;
  /** keptArs as a share of earnedArs, exact (0 when nothing was earned). */
  keptPct: number;
  /** The average keptPct of the 3 to 6 latest earlier months with a rate; absent below 3 (D-85). */
  typicalPct?: number;
  /** How many earlier rated months typicalPct averages (or, below 3, how many there are). */
  typicalMonths: number;
  /** Spending exceeds earnings (AC-11). */
  bad: boolean;
  /** By how much, in a bad month. */
  overArs?: number;
  /** The month has no dollar rate yet: its dollars are not in the pesos (D-31). */
  noRate: boolean;
  /** The month's pesos per dollar, when it has one. */
  rate?: number;
};

/** Typical month needs this many earlier rated months and averages up to TYPICAL_MAX (D-85). */
export const TYPICAL_MIN = 3;
export const TYPICAL_MAX = 6;

/** Dollar cents to peso cents at a rate with two decimals, rounded half away from zero, in integers. */
export function arsCents(usdCents: number, arsPerUsd: number): number {
  const product = usdCents * Math.round(arsPerUsd * 100);
  return Math.sign(product) * Math.floor((Math.abs(product) + 50) / 100);
}

/** Sum of one kind's cents in one currency, over every category. */
function kindSum(totals: MonthTotals['totals'] | undefined, kind: string, currency: string): number {
  let sum = 0;
  for (const byCurrency of Object.values(totals?.[kind] ?? {})) sum += byCurrency[currency] ?? 0;
  return sum;
}

/** One month's earned, spent, kept and kept share; dollars count only when a rate is given. */
function monthFigures(totals: MonthTotals['totals'] | undefined, rate: number | undefined) {
  const usd = (cents: number) => (rate === undefined ? 0 : arsCents(cents, rate));
  const earnedUsd = kindSum(totals, 'income', 'USD');
  const earnedArs = kindSum(totals, 'income', 'ARS') + usd(earnedUsd);
  const spentArs = 0 - (kindSum(totals, 'expense', 'ARS') + usd(kindSum(totals, 'expense', 'USD')));
  const keptArs = earnedArs - spentArs;
  const keptPct = earnedArs > 0 ? (keptArs / earnedArs) * 100 : 0;
  return { earnedArs, earnedUsd, spentArs, keptArs, keptPct };
}

export function overviewModel(month: string, totals: readonly MonthTotals[], rates: readonly Rate[]): OverviewModel {
  const rateOf = new Map(rates.map((r) => [r.month, r.ars_per_usd]));
  const byMonth = new Map(totals.map((t) => [t.month, t.totals]));
  const rate = rateOf.get(month);
  const current = monthFigures(byMonth.get(month), rate);

  // Typical month: the latest earlier months that have totals and a rate, at most six; none below three.
  const earlier = [...byMonth.keys()]
    .filter((m) => m < month && rateOf.has(m))
    .sort()
    .slice(-TYPICAL_MAX);
  const shares = earlier.map((m) => monthFigures(byMonth.get(m), rateOf.get(m)).keptPct);
  const typicalPct = shares.length >= TYPICAL_MIN ? shares.reduce((a, b) => a + b, 0) / shares.length : undefined;

  const bad = current.spentArs > current.earnedArs;
  return {
    ...current,
    ...(typicalPct === undefined ? {} : { typicalPct }),
    typicalMonths: shares.length,
    bad,
    ...(bad ? { overArs: current.spentArs - current.earnedArs } : {}),
    noRate: rate === undefined,
    ...(rate === undefined ? {} : { rate }),
  };
}
