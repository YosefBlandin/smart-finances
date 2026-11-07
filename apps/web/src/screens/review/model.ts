import type { ReviewReply } from '@/queries/keys';
import type { ReviewChoice } from './View';

// The review screen's words-free logic (SF-166; D-131): a choice applied to the rows at once, and the undo of one
// refused choice that leaves every other choice in flight as it is shown.

/** The list with the choice applied: an approved row leaves it, a category is shown on its row. */
export function applyChoice(reply: ReviewReply, choice: ReviewChoice): ReviewReply {
  if (choice.approved) return { ...reply, items: reply.items.filter((row) => row.id !== choice.id) };
  return { ...reply, items: reply.items.map((row) => (row.id === choice.id && choice.category ? { ...row, category: choice.category } : row)) };
}

/**
 * The shown list with one refused choice undone: its row as it was before that choice (back in its place when the
 * choice had approved it away); every other row stays as shown.
 */
export function undoChoice(shown: ReviewReply, before: ReviewReply, id: string): ReviewReply {
  const previous = before.items.find((row) => row.id === id);
  if (!previous) return shown;
  if (shown.items.some((row) => row.id === id)) {
    return { ...shown, items: shown.items.map((row) => (row.id === id ? previous : row)) };
  }
  const order = new Map(before.items.map((row, i) => [row.id, i]));
  const at = order.get(id)!;
  const next = shown.items.findIndex((row) => (order.get(row.id) ?? Number.POSITIVE_INFINITY) > at);
  const items = [...shown.items];
  items.splice(next === -1 ? items.length : next, 0, previous);
  return { ...shown, items };
}
