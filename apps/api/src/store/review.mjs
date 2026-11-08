// The review list and review choices (D-8, architecture.md "HTTP routes" PUT review). A choice
// is stored apart from its row at OVR#<date>#<id>, only for payments report rows, and applied on
// top of the row wherever rows are read; re-importing the file leaves it in place.
import { eraseCheck } from './imports.mjs';
import { ovrKey, txnKey } from './keys.mjs';
import { ConditionFailed } from './memory.mjs';
import { allRows, reviewOf, shownRow } from './query.mjs';

// GET /review: every row with a review reason that no approval hides, oldest first.
export async function reviewList(store, sub) {
  const items = [];
  for (const { row, choice } of await allRows(store, sub)) {
    const { review, ...shown } = shownRow(row, choice);
    if (review.reasons.length) items.push({ ...shown, reasons: review.reasons });
  }
  return items;
}

// PUT /transactions/{id}/review. Outcomes: { review } | { error: not_found | source_file_only | conflict }.
// Fields left out keep their stored value.
export async function putReview(store, sub, id, { date, category, approved }, { now = Date.now() } = {}) {
  const rowKey = txnKey(sub, date, id);
  const row = await store.get(rowKey, { consistent: true });
  if (!row) return { error: 'not_found' };
  if (row.source !== 'mercadopago') return { error: 'source_file_only' };
  const key = ovrKey(sub, date, id);
  const before = await store.get(key, { consistent: true });
  const choice = {
    ...key,
    date,
    month: date.slice(0, 7),
    ...((category ?? before?.category) ? { category: category ?? before.category } : {}),
    approved: approved ?? before?.approved ?? false,
    updated_at: new Date(now).toISOString(),
  };
  try {
    // One transaction: not in the erase window, the row still exists, then the choice.
    await store.transact([eraseCheck(sub, now), { check: rowKey, if: [{ attr: 'sk', exists: true }] }, { put: choice }]);
  } catch (err) {
    if (err instanceof ConditionFailed) return { error: err.index === 1 ? 'not_found' : 'conflict' };
    throw err;
  }
  return { review: reviewOf(row, choice) };
}
