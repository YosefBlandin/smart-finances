import type { Meta, StoryObj } from '@storybook/nextjs';
import { useTranslations } from 'next-intl';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Button } from '../../primitives/Button/Button';
import { StateBlock } from './StateBlock';

const retry = fn();

function States() {
  const t = useTranslations();
  return (
    <>
      <StateBlock kind="loading" lines={4} />
      <StateBlock
        kind="empty"
        title={t('states.empty.dashboard.title')}
        text={t('states.empty.dashboard.text')}
        action={
          <Button variant="primary" icon="import">
            {t('states.empty.dashboard.action')}
          </Button>
        }
      />
      <StateBlock kind="error" title={t('states.errT')} text={t('states.errB')} onRetry={retry} />
      <StateBlock kind="partial" title={t('imports.skippedTitle', { n: 3 })} text={t('imports.stalledBody')} headingLevel={3} />
    </>
  );
}

const meta: Meta = { title: 'Patterns/StateBlock', render: () => <States />, parameters: { stack: 'column' } };
export default meta;
type Story = StoryObj;

export const Kinds: Story = {};
export const KindsEs: Story = { globals: { locale: 'es' } };
export const KindsDark: Story = { globals: { theme: 'dark' } };
export const KindsEsDark: Story = { globals: { locale: 'es', theme: 'dark' } };

/** Loading says so once and politely; the failed state offers a retry (AC-8). */
export const RetryAfterFailure: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('status')).toHaveTextContent('Loading');
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(retry).toHaveBeenCalledTimes(1);
  },
};
