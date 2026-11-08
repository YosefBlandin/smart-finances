// Month totals (architecture.md Contracts "Rollup", D-14, D-29). A month's total is recomputed
// from a consistent read of its rows and review choices, and written only when no newer
// computation exists and the person is not erasing or in the quiet window after an erase.
// A lost condition means newer data or an erase already won; it is not an error, so an erase's
// own deletions never send a batch to the failure queue. A refused erase removes its marker
// again at once, so a lost erase check re-reads the marker and recomputes if it is gone.
import { eraseCheck } from './imports.mjs';
import { erasedKey, monthRange, PREFIX, personPk, sumKey } from './keys.mjs';
import { ConditionFailed } from './memory.mjs';

// The part of a TXN# or OVR# sort key after its prefix, <date>#<id>, so a choice finds its row.
const rowKey = (sk, prefix) => sk.slice(prefix.length);

// Rows of one month, each with its review choice (or none), as stored.
export async function monthRows(store, sub, from, to = from) {
  const pk = personPk(sub);
  const [rows, choices] = await Promise.all([
    store.query({ pk, between: monthRange(PREFIX.TXN, from, to), consistent: true }),
    store.query({ pk, between: monthRange(PREFIX.OVR, from, to), consistent: true }),
  ]);
  const bySk = new Map(choices.items.map((c) => [rowKey(c.sk, PREFIX.OVR), c]));
  return rows.items.map((row) => ({ row, choice: bySk.get(rowKey(row.sk, PREFIX.TXN)) }));
}

// The category a row counts under: the review choice's, when it set one.
export const categoryOf = (row, choice) => choice?.category ?? row.category;

// { kind: { category: { currency: cents } } }
export function sumRows(rows) {
  const totals = {};
  for (const { row, choice } of rows) {
    const byCategory = (totals[row.kind] ??= {});
    const byCurrency = (byCategory[categoryOf(row, choice)] ??= {});
    byCurrency[row.currency] = (byCurrency[row.currency] ?? 0) + row.amount;
  }
  return totals;
}

export async function recomputeMonth(store, sub, month, { now = Date.now() } = {}) {
  const key = sumKey(sub, month);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const t = now;
    const rows = await monthRows(store, sub, month);
    const total = { ...key, month, totals: sumRows(rows), row_count: rows.length, computed_at: t };
    try {
      await store.transact([
        eraseCheck(sub, t),
        { put: total, if: [{ any: [{ attr: 'sk', exists: false }, { attr: 'computed_at', op: '<', value: t }] }] },
      ]);
      return { written: true, row_count: rows.length };
    } catch (err) {
      if (!(err instanceof ConditionFailed)) throw err;
      if (err.index !== 0) return { skipped: true };
    }
    // Still marked: an erase is running or quiet. Gone again: a refused erase; recompute once more.
    if (await store.get(erasedKey(sub), { consistent: true })) return { skipped: true };
  }
  return { skipped: true };
}

// Every month that has a row or a stored total (rebuild, architecture.md "HTTP routes").
export async function monthsWithData(store, sub) {
  const pk = personPk(sub);
  const [rows, sums] = await Promise.all([
    store.query({ pk, prefix: PREFIX.TXN, consistent: true }),
    store.query({ pk, prefix: PREFIX.SUM, consistent: true }),
  ]);
  const months = new Set([
    ...rows.items.map((i) => i.sk.slice(PREFIX.TXN.length, PREFIX.TXN.length + 7)),
    ...sums.items.map((i) => i.sk.slice(PREFIX.SUM.length)),
  ]);
  return [...months].sort();
}
