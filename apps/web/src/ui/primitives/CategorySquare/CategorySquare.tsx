// CategorySquare: the solid square that marks a category everywhere, in lists and the overview's rows alike (D-34).
// A category keeps one colour token (D-25); grey (--cat6) is only for "Everything else", so it is 'other', never a number.
import styles from './CategorySquare.module.css';

export const CATEGORY_COLOURS = [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 'other'] as const;
export type CategoryColour = (typeof CATEGORY_COLOURS)[number];

export function CategorySquare({ cat }: { cat: CategoryColour }) {
  return <span className={styles.square} data-cat={String(cat)} aria-hidden="true" />;
}
