import type { Meta, StoryObj } from '@storybook/nextjs';
import { useTranslations } from 'next-intl';
import { Note } from './Note';

function Showcase() {
  const t = useTranslations();
  return (
    <>
      <Note>{t('transactions.choiceKept')}</Note>
      <Note tone="warn" title={t('imports.stalledTitle')}>
        {t('imports.stalledBody')}
      </Note>
      <Note tone="error" role="alert">
        {t('auth.signIn.errWrong')}
      </Note>
    </>
  );
}

const meta: Meta = { title: 'Primitives/Note', render: () => <Showcase />, parameters: { stack: 'column' } };
export default meta;
type Story = StoryObj;

export const Tones: Story = {};
export const TonesEs: Story = { globals: { locale: 'es' } };
export const TonesDark: Story = { globals: { theme: 'dark' } };
export const TonesEsDark: Story = { globals: { locale: 'es', theme: 'dark' } };
