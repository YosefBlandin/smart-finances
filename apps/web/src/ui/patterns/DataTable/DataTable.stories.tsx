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
