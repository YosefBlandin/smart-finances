// DataTable: a compound table (D-143): Root, Header, Column, Body, Row, Cell. Plain table elements (D-141 keeps simple
// parts plain); the scroll box is a labelled region the keyboard can focus, so wide tables scroll without a mouse (AC-10).
// Raw imported text renders as text in Chivo Mono (AC-9, D-16).
import { useId, type ReactNode } from 'react';
import styles from './DataTable.module.css';

type Align = 'start' | 'end';

function Root({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    // A scrollable region must take focus to scroll by keyboard (WCAG 2.1.1); it is named by the caption.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className={styles.wrap} role="region" aria-labelledby={id} tabIndex={0}>
      <table className={styles.table}>
        <caption id={id} className={styles.caption}>
          {label}
        </caption>
        {children}
      </table>
    </div>
  );
}

function Header({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr>{children}</tr>
    </thead>
  );
}

type ColumnProps = {
  align?: Align;
  sort?: 'ascending' | 'descending' | 'none';
  onSort?: () => void;
  children: ReactNode;
};

function Column({ align = 'start', sort, onSort, children }: ColumnProps) {
  return (
    <th scope="col" className={styles.column} data-align={align} aria-sort={sort}>
      {onSort ? (
        <button type="button" className={styles.sort} onClick={onSort}>
          {children}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

function Body({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

function Row({ selected, children }: { selected?: boolean; children: ReactNode }) {
  return (
    <tr className={styles.row} data-selected={selected || undefined}>
      {children}
    </tr>
  );
}

function Cell({ align = 'start', raw, children }: { align?: Align; raw?: boolean; children: ReactNode }) {
  return (
    <td className={styles.cell} data-align={align} data-raw={raw || undefined}>
      {children}
    </td>
  );
}

export const DataTable = { Root, Header, Column, Body, Row, Cell };
