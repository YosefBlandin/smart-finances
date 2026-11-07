// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en.json';
import es from '../../../../messages/es.json';
import { StateBlock } from './StateBlock';

afterEach(cleanup);

const wrap = (ui: ReactElement, locale: 'en' | 'es' = 'en') =>
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'es' ? es : en} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );

describe('T-WEB-9: StateBlock (AC-8, D-128)', () => {
  it('T-WEB-9 loading is a polite status with skeleton lines and the word Loading, never a spinner', () => {
    const { container } = wrap(<StateBlock kind="loading" lines={4} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Loading');
    expect(container.querySelectorAll('[data-width]')).toHaveLength(4);
    expect(container.querySelector('[data-spinner]')).toBeNull();
  });

  it('T-WEB-9 empty says what is missing and offers the next step', () => {
    wrap(<StateBlock kind="empty" title="No imports yet" text="Choose where the file comes from." action={<a href="/imports">Import a file</a>} />);
    expect(screen.getByRole('heading', { name: 'No imports yet', level: 2 })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Import a file' })).toBeTruthy();
  });

  it('T-WEB-9 failed says so in plain words with a retry in the reader’s language', () => {
    const onRetry = vi.fn();
    wrap(<StateBlock kind="error" title="No se pudo cargar esta pantalla." onRetry={onRetry} headingLevel={3} />, 'es');
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('No se pudo cargar esta pantalla.');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('T-WEB-9 the kind is a data attribute', () => {
    const { container } = wrap(<StateBlock kind="partial" title="Some rows were skipped" />);
    expect(container.querySelector('[data-kind]')?.getAttribute('data-kind')).toBe('partial');
  });
});
