import type { Meta, StoryObj } from '@storybook/nextjs';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import { CategorySquare, type CategoryColour } from '../../primitives/CategorySquare/CategorySquare';
import { DataTable } from './DataTable';

// Synthetic rows only.
const ROWS: { date: string; place: string; raw: string; cat: CategoryColour; category: string; amount: string }[] = [
  {
    date: '2026-03-02',
    place: 'Verdulería Sintética',
    raw: 'COMPRA VERDULERIA SINTETICA 0001',
    cat: 2,
    category: 'groceries',
    amount: '−ARS 12,500.00',
  },
  { date: '2026-03-05', place: 'Café Ejemplo', raw: 'PAGO QR CAFE EJEMPLO 0002', cat: 3, category: 'dining_out', amount: '−ARS 4,350.50' },
  {
    date: '2026-03-09',
    place: 'Software Demo',
    raw: 'SUBSCRIPTION DEMO SOFTWARE 0003',
    cat: 5,
    category: 'subscriptions_software',
    amount: '−USD 4.10',
  },
];

function Table() {
  const t = useTranslations();
  const [order, setOrder] = useState<'ascending' | 'descending'>('descending');
  const rows = order === 'ascending' ? ROWS : [...ROWS].reverse();
  return (
    <DataTable.Root label={t('nav.transactions')}>
      <DataTable.Header>
        <DataTable.Column sort={order} onSort={() => setOrder(order === 'ascending' ? 'descending' : 'ascending')}>
          {t('transactions.date')}
        </DataTable.Column>
        <DataTable.Column>{t('transactions.place')}</DataTable.Column>
        <DataTable.Column>{t('transactions.original')}</DataTable.Column>
        <DataTable.Column>{t('transactions.category')}</DataTable.Column>
        <DataTable.Column align="end">{t('transactions.amount')}</DataTable.Column>
      </DataTable.Header>
      <DataTable.Body>
        {rows.map((row, i) => (
          <DataTable.Row key={row.date} selected={i === 0}>
            <DataTable.Cell>{row.date}</DataTable.Cell>
            <DataTable.Cell>{row.place}</DataTable.Cell>
            <DataTable.Cell raw>{row.raw}</DataTable.Cell>
            <DataTable.Cell>
              <CategorySquare cat={row.cat} /> {t(`categories.${row.category}`)}
            </DataTable.Cell>
            <DataTable.Cell align="end">{row.amount}</DataTable.Cell>
          </DataTable.Row>
        ))}
      </DataTable.Body>
    </DataTable.Root>
  );
}

const meta: Meta = { title: 'Patterns/DataTable', render: () => <Table />, parameters: { stack: 'column' } };
export default meta;
type Story = StoryObj;

export const Transactions: Story = {};
export const TransactionsEs: Story = { globals: { locale: 'es' } };
export const TransactionsDark: Story = { globals: { theme: 'dark' } };
export const TransactionsEsDark: Story = { globals: { locale: 'es', theme: 'dark' } };

/** The sortable header is a button and the header says the order. */
export const SortByDate: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = canvas.getByRole('columnheader', { name: 'Date' });
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    await userEvent.click(canvas.getByRole('button', { name: 'Date' }));
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
  },
};

/** Rows the keyboard can focus (category-suggestions AC-10): one roving tab stop; Up and Down move it. */
function KeyRows() {
  const [at, setAt] = useState(0);
  return (
    <DataTable.Root label="Rows">
      <DataTable.Header>
        <DataTable.Column>Date</DataTable.Column>
        <DataTable.Column>Place</DataTable.Column>
      </DataTable.Header>
      <DataTable.Body>
        {ROWS.map((row, i) => (
          <DataTable.Row
            key={row.date}
            tabIndex={i === at ? 0 : -1}
            aria-label={row.place}
            aria-keyshortcuts="ArrowUp ArrowDown"
            ref={(el) => {
              if (el && i === at && el.ownerDocument.activeElement?.closest('tbody') === el.parentElement) el.focus();
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setAt(Math.min(at + 1, ROWS.length - 1));
              if (e.key === 'ArrowUp') setAt(Math.max(at - 1, 0));
            }}
          >
            <DataTable.Cell>{row.date}</DataTable.Cell>
            <DataTable.Cell>{row.place}</DataTable.Cell>
          </DataTable.Row>
        ))}
      </DataTable.Body>
    </DataTable.Root>
  );
}

export const KeyboardRows: Story = {
  render: () => <KeyRows />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByRole('row', { name: 'Verdulería Sintética' });
    await expect(first).toHaveAttribute('tabindex', '0');
    first.focus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(canvas.getByRole('row', { name: 'Café Ejemplo' })).toHaveFocus();
    await expect(first).toHaveAttribute('tabindex', '-1');
  },
};
