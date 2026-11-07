// Reading one person's rows for a range of months (D-26): the rows and their review choices are
// read for the asked months, the choices applied, and then filtered, sorted and paged here.
import { FIELDS } from '@smart-finances/contracts/fields';
import { categoryOf, monthRows } from './totals.mjs';

// The flags that put a row on the review list (Values: "Review reasons").
export const REVIEW_FLAGS = ['needs_review', 'possible_duplicate'];

// Only the schema's fields leave the store; pk, sk, period and import_id stay inside.
const fieldsOf = (row) => Object.fromEntries(FIELDS.map((f) => [f, row[f]]));

// The review block of one row: approved true clears the reasons (Values).
export function reviewOf(row, choice) {
  const approved = choice?.approved === true;
  return {
    reasons: approved ? [] : REVIEW_FLAGS.filter((f) => (row.flags ?? []).includes(f)),
    ...(choice?.category ? { category_override: choice.category } : {}),
    approved,
    ...(choice?.updated_at ? { updated_at: choice.updated_at } : {}),
  };
}

// The row as the reader sees it: its review choice's category applied, plus its review block.
export function shownRow(row, choice) {
  return { ...fieldsOf(row), category: categoryOf(row, choice), review: reviewOf(row, choice) };
}

export async function shownRows(store, sub, from, to) {
  return (await monthRows(store, sub, from, to)).map(({ row, choice }) => shownRow(row, choice));
}

const byDateThenId = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const COMPARE = {
  date: byDateThenId,
  amount: (a, b) => a.amount - b.amount || byDateThenId(a, b),
};

// query: the parsed GET /transactions request (defaults applied). Review choices apply before filters.
export function selectRows(rows, { category, kind, q, sort, order }) {
  const needle = q?.toLowerCase();
  const hit = (row) =>
    (category === undefined || row.category === category)
    && (kind === undefined || row.kind === kind)
    && (!needle || [row.description_raw, row.merchant, row.category].some((text) => String(text ?? '').toLowerCase().includes(needle)));
  const sign = order === 'asc' ? 1 : -1;
  return rows.filter(hit).sort((a, b) => sign * COMPARE[sort](a, b));
}
