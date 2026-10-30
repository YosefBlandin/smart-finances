// CategoryRow: one category in a list of where the money went: the solid square (D-34), the name, the amount and the
// share. Amounts arrive already formatted (D-23, D-30). CategoryRow.List is the labelled list around the rows.
import type { ReactNode } from 'react';
import { CategorySquare, type CategoryColour } from '../../primitives/CategorySquare/CategorySquare';
import styles from './CategoryRow.module.css';

export type CategoryRowProps = { cat: CategoryColour; name: string; amount: string; share?: string };

function Row({ cat, name, amount, share }: CategoryRowProps) {
  return (
    <li className={styles.row} data-share={share ? true : undefined}>
      <CategorySquare cat={cat} />
      <span className={styles.name}>{name}</span>
      <span className={styles.amount}>{amount}</span>
      {share ? <span className={styles.share}>{share}</span> : null}
    </li>
  );
}

function List({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className={styles.list} aria-label={label}>
      {children}
    </ul>
  );
}

export const CategoryRow = Object.assign(Row, { List });
