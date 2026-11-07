import type { Meta, StoryObj } from '@storybook/nextjs';
import { useTranslations } from 'next-intl';
import { Skeleton } from './Skeleton';

function Showcase() {
  const t = useTranslations();
  return (
    <>
      <p>{t('states.loading')}</p>
      <Skeleton height="title" width="half" />
      <Skeleton width="full" />
      <Skeleton width="wide" />
      <Skeleton width="short" />
      <Skeleton height="block" />
    </>
  );
}

const meta: Meta = { title: 'Primitives/Skeleton', render: () => <Showcase />, parameters: { stack: 'column' } };
export default meta;
type Story = StoryObj;

export const Sizes: Story = {};
export const SizesEs: Story = { globals: { locale: 'es' } };
export const SizesDark: Story = { globals: { theme: 'dark' } };
export const SizesEsDark: Story = { globals: { locale: 'es', theme: 'dark' } };
