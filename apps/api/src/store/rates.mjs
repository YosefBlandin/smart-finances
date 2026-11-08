// Monthly peso rates and the dollar view (D-7, D-27, D-39). A rate is pesos per dollar with two
// decimals: a number on the wire, a string with exactly two decimals in the table. The dollar
// view is computed on read in integer cents: usd = round(ars cents x 100 / rate hundredths),
// half away from zero; dollar amounts pass through.
import { eraseCheck } from './imports.mjs';
import { monthRange, PREFIX, personPk, rateKey } from './keys.mjs';
import { ConditionFailed } from './memory.mjs';

const hundredths = (stored) => Math.round(Number(stored) * 100);

export async function listRates(store, sub) {
  const { items } = await store.query({ pk: personPk(sub), prefix: PREFIX.RATE, consistent: true });
  return items.map((r) => ({ month: r.sk.slice(PREFIX.RATE.length), ars_per_usd: Number(r.ars_per_usd) }));
}

// Refused with { conflict: true } from erased_at until quiet_until, so no late write outlives an erase.
export async function putRate(store, sub, month, arsPerUsd, { now = Date.now() } = {}) {
  const item = { ...rateKey(sub, month), ars_per_usd: (Math.round(arsPerUsd * 100) / 100).toFixed(2), updated_at: new Date(now).toISOString() };
  try {
    await store.transact([eraseCheck(sub, now), { put: item }]);
  } catch (err) {
    if (err instanceof ConditionFailed) return { conflict: true };
    throw err;
  }
  return { month, ars_per_usd: Number(item.ars_per_usd) };
}

// n / d rounded half away from zero, in integers (d > 0).
export function divideRounded(n, d) {
  const q = Math.trunc(n / d);
  const r = n - q * d;
  if (2 * Math.abs(r) >= d) return q + Math.sign(n);
  return q;
}

export const arsToUsd = (arsCents, rateHundredths) => divideRounded(arsCents * 100, rateHundredths);

// Stored month totals (tombstones skipped) for from..to, in the asked view.
export async function readTotals(store, sub, { from, to, view }) {
  const pk = personPk(sub);
  const [sums, rates] = await Promise.all([
    store.query({ pk, between: monthRange(PREFIX.SUM, from, to), consistent: true }),
    store.query({ pk, between: monthRange(PREFIX.RATE, from, to), consistent: true }),
  ]);
  const rateOf = new Map(rates.items.map((r) => [r.sk.slice(PREFIX.RATE.length), hundredths(r.ars_per_usd)]));
  const months = [];
  const missing = [];
  for (const sum of sums.items) {
    if (!sum.row_count) continue;
    const month = sum.sk.slice(PREFIX.SUM.length);
    const rate = rateOf.get(month);
    const hasPesos = Object.values(sum.totals).some((byCategory) => Object.values(byCategory).some((byCurrency) => 'ARS' in byCurrency));
    if (hasPesos && !rate) missing.push(month);
    months.push({ month, totals: view === 'usd' ? inDollars(sum.totals, rate) : sum.totals });
  }
  return { months, missing_rates: missing };
}

// Pesos become dollars at the month's rate; without a rate they stay out of the dollar figure.
function inDollars(totals, rate) {
  const out = {};
  for (const [kind, byCategory] of Object.entries(totals)) {
    for (const [category, byCurrency] of Object.entries(byCategory)) {
      for (const [currency, cents] of Object.entries(byCurrency)) {
        let usd;
        if (currency === 'USD') usd = cents;
        else if (currency === 'ARS' && rate) usd = arsToUsd(cents, rate);
        else continue;
        const cell = ((out[kind] ??= {})[category] ??= {});
        cell.USD = (cell.USD ?? 0) + usd;
      }
    }
  }
  return out;
}
