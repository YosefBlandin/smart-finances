import type { Meta, StoryObj } from '@storybook/nextjs';
import { useTranslations } from 'next-intl';
import { BandStrip } from './BandStrip';

// Synthetic shares of one month's spending.
function Strip() {
  const t = useTranslations();
  return (
    <BandStrip
      label={t('overview.stripLabel')}
      bands={[
        { cat: 1, share: 0.34, name: t('categories.housing_utilities') },
        { cat: 2, share: 0.21, name: t('categories.groceries') },
        { cat: 3, share: 0.14, name: t('categories.dining_out') },
        { cat: 4, share: 0.1, name: t('categories.transport') },
        { cat: 5, share: 0.08, name: t('categories.subscriptions_software') },
        { cat: 7, share: 0.05, name: t('categories.health_fitness') },
        { cat: 'other', share: 0.08, name: t('overview.everythingElse') },
      ]}
    />
  );
}

const meta: Meta = { title: 'Patterns/BandStrip', render: () => <Strip />, parameters: { stack: 'column' } };
export default meta;
type Story = StoryObj;

export const Month: Story = {};
export const MonthEs: Story = { globals: { locale: 'es' } };
export const MonthDark: Story = { globals: { theme: 'dark' } };
export const MonthEsDark: Story = { globals: { locale: 'es', theme: 'dark' } };
