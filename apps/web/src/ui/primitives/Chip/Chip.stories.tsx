import type { Meta, StoryObj } from '@storybook/nextjs';
import { useTranslations } from 'next-intl';
import { Chip } from './Chip';

function Showcase() {
  const t = useTranslations();
  return (
    <>
      <Chip tone="ok">{t('imports.status.done')}</Chip>
      <Chip tone="running">{t('imports.status.importing')}</Chip>
      <Chip tone="warn">{t('imports.status.stalled')}</Chip>
      <Chip tone="failed">{t('imports.status.failed')}</Chip>
      <Chip tone="failed">{t('imports.status.expired')}</Chip>
      <Chip tone="idle">{t('imports.status.superseded')}</Chip>
    </>
  );
}

const meta: Meta = { title: 'Primitives/Chip', render: () => <Showcase /> };
export default meta;
type Story = StoryObj;

export const Tones: Story = {};
export const TonesEs: Story = { globals: { locale: 'es' } };
export const TonesDark: Story = { globals: { theme: 'dark' } };
export const TonesEsDark: Story = { globals: { locale: 'es', theme: 'dark' } };
