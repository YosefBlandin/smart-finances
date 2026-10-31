// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
