import type { Meta, StoryObj } from '@storybook/nextjs';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import { Button } from '../../primitives/Button/Button';
import { ConfirmDialog } from './ConfirmDialog';

function DeleteEverything({ startOpen = false }: { startOpen?: boolean }) {
  const t = useTranslations();
  const [open, setOpen] = useState(startOpen);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant="danger" icon="trash" onClick={() => setOpen(true)}>
        {t('data.delBtn')}
      </Button>
      <ConfirmDialog
        isOpen={open}
        onOpenChange={setOpen}
        title={t('data.delTitle')}
        confirmLabel={t('data.delBtn')}
        confirmWord="DELETE"
        destructive
        busy={busy}
        onConfirm={() => setBusy(true)}
      >
        <p>{t('data.delBody')}</p>
        <p>{t('data.delBackup')}</p>
      </ConfirmDialog>
    </>
  );
}

const meta: Meta = { title: 'Patterns/ConfirmDialog', render: () => <DeleteEverything startOpen /> };
export default meta;
type Story = StoryObj;

export const Destructive: Story = {};
export const DestructiveEs: Story = { globals: { locale: 'es' } };
export const DestructiveDark: Story = { globals: { theme: 'dark' } };
export const DestructiveEsDark: Story = { globals: { locale: 'es', theme: 'dark' } };

/** The red button waits for DELETE, then spins while the erase runs (AC-7, D-128, D-146). */
export const TypeTheWord: Story = {
  render: () => <DeleteEverything />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Delete everything' }));
    const dialog = within(await within(document.body).findByRole('alertdialog'));
    const confirm = dialog.getByRole('button', { name: 'Delete everything' });
    await expect(confirm).toBeDisabled();
    await userEvent.type(dialog.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await expect(confirm).toHaveAttribute('aria-busy', 'true');
  },
};
