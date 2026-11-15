// Recipient labels (D-7, D-13, D-18; ADR 0010): one item per recipient key, LBL#<recipient_key>, under the
// person's partition. A label is stored once and applied wherever rows are read, never written into the rows,
// so past and future rows with the key follow it. The rollup ignores LBL items; the label route asks for a rebuild.
import { eraseCheck } from './imports.mjs';
import { lblKey, PREFIX, personPk } from './keys.mjs';
import { ConditionFailed } from './memory.mjs';

// The person's labels by recipient key: one small prefix query.
export async function readLabels(store, sub) {
  const { items } = await store.query({ pk: personPk(sub), prefix: PREFIX.LBL, consistent: true });
  return new Map(items.map((l) => [l.recipient_key, l]));
}

// The label of a row, if its recipient has one.
export const labelOf = (labels, row) => (row?.recipient_key ? labels.get(row.recipient_key) : undefined);

// A row and its review choice with the label folded in (Contracts "How a label applies"): the label's name is
// the shown merchant, its category beats the choice's and the row's, and it approves the row.
export function withLabel(row, choice, label) {
  if (!label) return { row, choice };
  return {
    row: { ...row, merchant: label.name },
    choice: { ...choice, category: label.category, approved: true, updated_at: choice?.updated_at ?? label.updated_at },
  };
}

// Writes or replaces the label of one recipient key, with the erase check in the same transaction (D-30).
// The route checks the input shape; name is trimmed here. Outcomes: { label } | { error: 'conflict' }.
export async function putLabel(store, sub, recipientKey, { name, category }, { now = Date.now() } = {}) {
  const label = {
    ...lblKey(sub, recipientKey),
    recipient_key: recipientKey,
    name: String(name).trim(),
    category,
    updated_at: new Date(now).toISOString(),
  };
  try {
    await store.transact([eraseCheck(sub, now), { put: label }]);
  } catch (err) {
    if (err instanceof ConditionFailed && err.index === 0) return { error: 'conflict' };
    throw err;
  }
  const { pk: _pk, sk: _sk, ...shown } = label;
  return { label: shown };
}
