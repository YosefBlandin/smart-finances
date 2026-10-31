// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en.json';
import es from '../../../../messages/es.json';
import { ConfirmDialog } from './ConfirmDialog';

afterEach(cleanup);

const wrap = (ui: ReactElement, locale: 'en' | 'es' = 'en') =>
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'es' ? es : en} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );

describe('T-WEB-9: ConfirmDialog (AC-7, D-146)', () => {
  it('T-WEB-9 a destructive dialog is an alert dialog with a danger button that waits for the typed word', async () => {
    const onConfirm = vi.fn();
    wrap(
      <ConfirmDialog
        isOpen
        onOpenChange={() => {}}
        title="Delete everything"
        confirmLabel="Delete everything"
        confirmWord="DELETE"
        destructive
        onConfirm={onConfirm}
      >
        Removes every transaction, file, choice and rate.
      </ConfirmDialog>,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Delete everything' });
    const confirm = screen.getByRole('button', { name: 'Delete everything' });
    expect(dialog.contains(confirm)).toBe(true);
    expect(confirm.getAttribute('data-variant')).toBe('danger');
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    const word = screen.getByLabelText('Type DELETE to confirm');
    await act(async () => fireEvent.change(word, { target: { value: 'delete' } }));
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await act(async () => fireEvent.change(word, { target: { value: 'DELETE' } }));
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    await act(async () => fireEvent.click(confirm));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('T-WEB-9 a plain confirmation uses the primary button and Cancel closes it, in Spanish too', async () => {
    const onOpenChange = vi.fn();
    wrap(
      <ConfirmDialog isOpen onOpenChange={onOpenChange} title="Deshacer" confirmLabel="Deshacer esta importación" onConfirm={() => {}}>
        Vuelven las filas del archivo anterior.
      </ConfirmDialog>,
      'es',
    );
    expect(screen.getByRole('button', { name: 'Deshacer esta importación' }).getAttribute('data-variant')).toBe('primary');
    expect(screen.queryByLabelText(/DELETE/)).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancelar' })));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('T-WEB-9 while busy the confirm button spins and Cancel is disabled', () => {
    wrap(
      <ConfirmDialog isOpen onOpenChange={() => {}} title="Delete" confirmLabel="Delete my account" destructive busy onConfirm={() => {}}>
        Body
      </ConfirmDialog>,
    );
    expect(screen.getByRole('button', { name: 'Delete my account' }).getAttribute('aria-busy')).toBe('true');
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('T-WEB-9 closed, nothing is rendered', () => {
    wrap(
      <ConfirmDialog isOpen={false} onOpenChange={() => {}} title="Delete" confirmLabel="Delete" onConfirm={() => {}}>
        Body
      </ConfirmDialog>,
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
