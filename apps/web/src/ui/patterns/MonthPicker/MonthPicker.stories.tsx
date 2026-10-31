import type { Meta, StoryObj } from '@storybook/nextjs';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { MonthPicker, type MonthInfo } from './MonthPicker';

// Synthetic months like the prototype's sample: November 2025 to October 2026, and October has no dollar rate yet.
const MONTHS: MonthInfo[] = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(Date.UTC(2025, 10 + i, 1));
  const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return { month, hasData: true, hasRate: month !== '2026-10' };
});

function Picker() {
  const [month, setMonth] = useState('2026-03');
  return <MonthPicker months={MONTHS} value={month} onChange={setMonth} />;
}

const meta: Meta = { title: 'Patterns/MonthPicker', render: () => <Picker /> };
export default meta;
type Story = StoryObj;

export const Closed: Story = {};
export const ClosedEs: Story = { globals: { locale: 'es' } };
export const ClosedDark: Story = { globals: { theme: 'dark' } };
export const ClosedEsDark: Story = { globals: { locale: 'es', theme: 'dark' } };

const openGrid = async (canvasElement: HTMLElement) => {
  await userEvent.click(within(canvasElement).getByRole('button'));
  return within(document.body).findByRole('dialog');
};

/** The grid opens on the chosen month; a month with no rate has the amber mark and its key; choosing closes it. */
export const ChooseAMonth: Story = {
  play: async ({ canvasElement }) => {
    const grid = await openGrid(canvasElement);
    await expect(within(grid).getByRole('button', { name: 'Mar 2026' })).toHaveAttribute('aria-current', 'date');
    await expect(within(grid).getByRole('button', { name: 'Oct 2026' })).toHaveAccessibleDescription('No dollar rate yet');
    await expect(within(grid).getByRole('button', { name: 'Oct 2025' })).toBeDisabled();
    await userEvent.click(within(grid).getByRole('button', { name: 'Sep 2026' }));
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull());
    await expect(within(canvasElement).getByRole('button')).toHaveTextContent('September 2026');
  },
};

/** Open in Spanish and dark, so the a11y check sees the grid itself. */
export const OpenEsDark: Story = {
  globals: { locale: 'es', theme: 'dark' },
  play: async ({ canvasElement }) => {
    const grid = await openGrid(canvasElement);
    await expect(within(grid).getByText('Sin cotización todavía')).toBeVisible();
  },
};
