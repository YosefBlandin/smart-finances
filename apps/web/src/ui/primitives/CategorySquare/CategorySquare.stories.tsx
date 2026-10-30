import type { Meta, StoryObj } from '@storybook/nextjs';
import { useTranslations } from 'next-intl';
import { CATEGORY_COLOURS, CategorySquare } from './CategorySquare';

const NAMES = [
  'housing_utilities',
  'groceries',
  'dining_out',
  'transport',
  'health_fitness',
  'subscriptions_software',
  'clothing',
  'home',
  'travel',
  'personal_care',
  'family',
] as const;

function Showcase() {
  const t = useTranslations();
  return (
    <ul aria-label={t('overview.byCat')}>
      {CATEGORY_COLOURS.map((cat, i) => (
        <li key={cat}>
          <CategorySquare cat={cat} /> {cat === 'other' ? t('overview.everythingElse') : t(`categories.${NAMES[i]!}`)}
        </li>
      ))}
    </ul>
  );
}

const meta: Meta = { title: 'Primitives/CategorySquare', render: () => <Showcase /> };
export default meta;
type Story = StoryObj;

export const Colours: Story = {};
export const ColoursEs: Story = { globals: { locale: 'es' } };
export const ColoursDark: Story = { globals: { theme: 'dark' } };
export const ColoursEsDark: Story = { globals: { locale: 'es', theme: 'dark' } };
