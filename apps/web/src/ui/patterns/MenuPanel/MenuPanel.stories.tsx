import type { Meta, StoryObj } from '@storybook/nextjs';
import { useTranslations } from 'next-intl';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { MenuPanel } from './MenuPanel';

const SCREENS = ['dashboard', 'transactions', 'review', 'imports', 'rates', 'data'] as const;

function Menu() {
  const t = useTranslations();
  return (
    <MenuPanel label={t('nav.dashboard')} count={3} countLabel={t('shell.toReview', { n: 3 })}>
      {(close) => (
        <nav aria-label={t('shell.groups.money')}>
          <ul>
            {SCREENS.map((s) => (
              <li key={s}>
                <a href={`#${s}`} onClick={close} aria-current={s === 'dashboard' ? 'page' : undefined}>
                  {t(`nav.${s}`)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </MenuPanel>
  );
}

const meta: Meta = { title: 'Patterns/MenuPanel', render: () => <Menu /> };
export default meta;
type Story = StoryObj;

export const Closed: Story = {};
export const ClosedEs: Story = { globals: { locale: 'es' } };
export const ClosedDark: Story = { globals: { theme: 'dark' } };
export const ClosedEsDark: Story = { globals: { locale: 'es', theme: 'dark' } };

/** The button opens the panel and shows a close mark; Escape closes it and focus goes back to the button. */
export const OpenAndClose: Story = {
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: /Overview/ });
    await userEvent.click(button);
    const panel = await within(document.body).findByRole('dialog', { name: 'Menu' });
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(within(panel).getByRole('link', { name: 'Transactions' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull());
    await expect(button).toHaveFocus();
  },
};
