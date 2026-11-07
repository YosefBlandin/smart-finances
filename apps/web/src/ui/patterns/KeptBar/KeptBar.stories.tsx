import type { Meta, StoryObj } from '@storybook/nextjs';
import { useLocale, useTranslations } from 'next-intl';
import { formatAmount, formatPercent, type Lang } from '../../../i18n/format';
import { KeptBar } from './KeptBar';

// Synthetic months: a good one (kept 32%, typical keeps 20%) and a bad one (overspent by USD 1,127.13).
function Bars() {
  const t = useTranslations();
  const lang = useLocale() as Lang;
  const pc = (n: number) => formatPercent(n, lang);
  const over = formatAmount(112713, 'USD', { locale: lang, summary: true });
  return (
    <>
      <KeptBar
        field="good"
        label={t('overview.splitGood', { s: pc(0.68), k: pc(0.32) })}
        solid={0.32}
        marker={0.8}
        markerLabel={t('overview.typicalKeeps', { p: pc(0.2) })}
        start={{ label: t('overview.barSpent'), value: pc(0.68) }}
        end={{ label: t('overview.barKept'), value: pc(0.32) }}
      />
      <KeptBar
        field="bad"
        label={t('overview.splitBad', { o: over })}
        solid={0.31}
        marker={0.69}
        markerLabel={t('overview.earnedOut')}
        start={{ label: t('overview.barSpent'), value: '' }}
        end={{ label: t('overview.overBy', { a: over }), value: '' }}
      />
    </>
  );
}

const meta: Meta = { title: 'Patterns/KeptBar', render: () => <Bars />, parameters: { stack: 'column' } };
export default meta;
type Story = StoryObj;

export const GoodAndBad: Story = {};
export const GoodAndBadEs: Story = { globals: { locale: 'es' } };
export const GoodAndBadDark: Story = { globals: { theme: 'dark' } };
export const GoodAndBadEsDark: Story = { globals: { locale: 'es', theme: 'dark' } };
