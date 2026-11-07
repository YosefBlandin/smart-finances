import { KINDS } from '@smart-finances/contracts/fields';
import type { TransactionFilters } from '@/queries/keys';

// The transactions screen's address (D-82, D-127): month, view, kind, category and sort live in the page address, so a
// reload or a shared link opens the same page; free text never does. Pure, for the server page and the island alike.

export type Address = {
  month: string;
  view?: 'native' | 'usd';
  kind?: string;
  category?: string;
  sort: 'date' | 'amount';
  order: 'asc' | 'desc';
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const SORTS = ['date-desc', 'date-asc', 'amount-desc', 'amount-asc'] as const;

/** The address's values, each checked; anything else falls back to the default (this month, every row, newest first). */
export function readAddress(search: Record<string, string | string[] | undefined>, now: string): Address {
  const one = (name: string) => {
    const v = search[name];
    return typeof v === 'string' && v !== '' ? v : undefined;
  };
  const month = one('month');
  const kind = one('kind');
  const category = one('category');
  const view = one('view');
  const sort = one('sort');
  const [by, order] = (sort && (SORTS as readonly string[]).includes(sort) ? sort : 'date-desc').split('-') as [Address['sort'], Address['order']];
  return {
    month: month && MONTH.test(month) ? month : now,
    ...(view === 'native' || view === 'usd' ? { view } : {}),
    ...(kind && (KINDS as readonly string[]).includes(kind) ? { kind } : {}),
    ...(category && category.length <= 64 ? { category } : {}),
    sort: by,
    order,
  };
}

/** The search part of the address, in a fixed order; the default sort (newest first) is left out. */
export function writeAddress(a: Address): string {
  const search = new URLSearchParams({ month: a.month });
  if (a.view) search.set('view', a.view);
  if (a.kind) search.set('kind', a.kind);
  if (a.category) search.set('category', a.category);
  if (a.sort !== 'date' || a.order !== 'desc') search.set('sort', `${a.sort}-${a.order}`);
  return search.toString();
}

/** The query's filters: the address plus the free text from the form (page size 50, PAGE_SIZE). */
export function filtersOf(a: Address, q?: string): TransactionFilters {
  return {
    month: a.month,
    ...(a.kind ? { kind: a.kind } : {}),
    ...(a.category ? { category: a.category } : {}),
    ...(q ? { q } : {}),
    sort: a.sort,
    order: a.order,
  };
}

/** A column header's press: the same column turns around; another starts newest first, or biggest spending first. */
export function toggleSort(a: Address, by: Address['sort']): Address {
  if (a.sort === by) return { ...a, order: a.order === 'asc' ? 'desc' : 'asc' };
  return { ...a, sort: by, order: by === 'amount' ? 'asc' : 'desc' };
}

/** yyyy-mm plus n months. */
export function addMonths(month: string, n: number): string {
  const i = Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1 + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}
