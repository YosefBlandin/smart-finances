import type { Meta, StoryObj } from '@storybook/nextjs';
import { useTranslations } from 'next-intl';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Button } from './Button';

function Showcase() {
  const t = useTranslations();
  return (
    <>
      <Button variant="primary">{t('auth.signIn.submit')}</Button>
      <Button icon="download">{t('data.download')}</Button>
      <Button size="sm">{t('review.approve')}</Button>
      <Button variant="primary" busy>
        {t('auth.signUp.creating')}
      </Button>
      <Button disabled>{t('imports.repair')}</Button>
      <Button variant="danger" icon="trash">
        {t('data.delBtn')}
      </Button>
    </>
  );
}

const meta: Meta = { title: 'Primitives/Button', render: () => <Showcase /> };
export default meta;
type Story = StoryObj;

export const Variants: Story = {};
export const VariantsEs: Story = { globals: { locale: 'es' } };
export const VariantsDark: Story = { globals: { theme: 'dark' } };
export const VariantsEsDark: Story = { globals: { locale: 'es', theme: 'dark' } };

const save = fn();

function BusyButton() {
  const t = useTranslations();
  return (
    <Button variant="primary" busy onClick={save}>
      {t('auth.consent.saving')}
    </Button>
  );
}

/** While its action runs the button spins, says aria-busy and ignores presses (D-128). */
export const BusyIgnoresPresses: Story = {
  render: () => <BusyButton />,
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button');
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    await expect(save).not.toHaveBeenCalled();
  },
};
