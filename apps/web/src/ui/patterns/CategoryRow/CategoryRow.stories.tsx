import type { Meta, StoryObj } from '@storybook/nextjs';
import { useLocale, useTranslations } from 'next-intl';
import { formatAmount, formatPercent, type Lang } from '../../../i18n/format';
import { CategoryRow } from './CategoryRow';

// Synthetic peso spending for one month, in cents.
const ROWS = [
  { cat: 1, key: 'housing_utilities', cents: 42000000 },
  { cat: 2, key: 'groceries', cents: 26150050 },
  { cat: 3, key: 'dining_out', cents: 17320000 },
  { cat: 4, key: 'transport', cents: 9800000 },
] as const;
const OTHER = 9000000;
const TOTAL = ROWS.reduce((sum, r) => sum + r.cents, OTHER);

function Rows() {
  const t = useTranslations();
  const lang = useLocale() as Lang;
  const amount = (cents: number) => formatAmount(cents, 'ARS', { locale: lang, summary: true });
  return (
    <CategoryRow.List label={t('overview.byCat')}>
      {ROWS.map((r) => (
        <CategoryRow key={r.key} cat={r.cat} name={t(`categories.${r.key}`)} amount={amount(r.cents)} share={formatPercent(r.cents / TOTAL, lang)} />
      ))}
      <CategoryRow cat="other" name={t('overview.everythingElse')} amount={amount(OTHER)} share={formatPercent(OTHER / TOTAL, lang)} />
    </CategoryRow.List>
  );
}

const meta: Meta = { title: 'Patterns/CategoryRow', render: () => <Rows />, parameters: { stack: 'column' } };
export default meta;
type Story = StoryObj;

export const WhereItWent: Story = {};
export const WhereItWentEs: Story = { globals: { locale: 'es' } };
export const WhereItWentDark: Story = { globals: { theme: 'dark' } };
export const WhereItWentEsDark: Story = { globals: { locale: 'es', theme: 'dark' } };
