// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from './DataTable';

afterEach(cleanup);

function Table({ onSort = () => {} }: { onSort?: () => void }) {
  return (
    <DataTable.Root label="Transactions">
      <DataTable.Header>
        <DataTable.Column sort="descending" onSort={onSort}>
          Date
        </DataTable.Column>
        <DataTable.Column align="end">Amount</DataTable.Column>
      </DataTable.Header>
      <DataTable.Body>
        <DataTable.Row selected>
          <DataTable.Cell>2026-03-02</DataTable.Cell>
          <DataTable.Cell align="end">ARS 12,500.00</DataTable.Cell>
        </DataTable.Row>
        <DataTable.Row>
          <DataTable.Cell raw>COMPRA MERCADO SINTETICO 0001</DataTable.Cell>
          <DataTable.Cell align="end">USD 4.10</DataTable.Cell>
        </DataTable.Row>
      </DataTable.Body>
    </DataTable.Root>
  );
}

describe('T-WEB-9: DataTable', () => {
  it('T-WEB-9 is a captioned table inside a labelled region the keyboard can scroll', () => {
    render(<Table />);
    const table = screen.getByRole('table', { name: 'Transactions' });
    const region = screen.getByRole('region', { name: 'Transactions' });
    expect(region.contains(table)).toBe(true);
    expect(region.getAttribute('tabindex')).toBe('0');
  });

  it('T-WEB-9 column headers are scoped, sortable ones say their order and sort with a button', () => {
    const onSort = vi.fn();
    render(<Table onSort={onSort} />);
    const date = screen.getByRole('columnheader', { name: 'Date' });
    expect(date.getAttribute('scope')).toBe('col');
    expect(date.getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(screen.getByRole('button', { name: 'Date' }));
    expect(onSort).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('columnheader', { name: 'Amount' }).getAttribute('data-align')).toBe('end');
  });

  it('T-WEB-9 rows mark selection and raw imported text as data attributes', () => {
    render(<Table />);
    const rows = screen.getAllByRole('row');
    expect(rows[1]?.getAttribute('data-selected')).toBe('true');
    expect(screen.getByText('COMPRA MERCADO SINTETICO 0001').getAttribute('data-raw')).toBe('true');
  });
});

describe('T-ROW-1: DataTable.Row pass-through', () => {
  it('T-ROW-1 passes tabIndex, key handlers, aria-keyshortcuts, aria-label and a ref to its row element', () => {
    const onKeyDown = vi.fn();
    const onKeyUp = vi.fn();
    const ref = createRef<HTMLTableRowElement>();
    render(
      <DataTable.Root label="Rows">
        <DataTable.Body>
          <DataTable.Row
            ref={ref}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            aria-keyshortcuts="Enter 1 2 3 ArrowUp ArrowDown"
            aria-label="Row one"
          >
            <DataTable.Cell>one</DataTable.Cell>
          </DataTable.Row>
          <DataTable.Row tabIndex={-1}>
            <DataTable.Cell>two</DataTable.Cell>
          </DataTable.Row>
        </DataTable.Body>
      </DataTable.Root>,
    );
    const row = screen.getByRole('row', { name: 'Row one' });
    expect(ref.current).toBe(row);
    expect(row.getAttribute('tabindex')).toBe('0');
    expect(row.getAttribute('aria-keyshortcuts')).toBe('Enter 1 2 3 ArrowUp ArrowDown');
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyUp(row, { key: 'Enter' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onKeyUp).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('row')[1]?.getAttribute('tabindex')).toBe('-1');
  });
});
