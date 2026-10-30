// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en.json';
import es from '../../../../messages/es.json';
import { MonthPicker } from './MonthPicker';

afterEach(cleanup);

const months = [
  { month: '2025-11', hasData: true, hasRate: true },
  { month: '2026-03', hasData: true, hasRate: true },
  { month: '2026-09', hasData: true, hasRate: true },
  { month: '2026-10', hasData: true, hasRate: false },
];

const wrap = (ui: ReactElement, locale: 'en' | 'es' = 'en') =>
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'es' ? es : en} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );

describe('T-WEB-9: MonthPicker (React Aria, D-141)', () => {
  it('T-WEB-9 the trigger names the month and the grid opens with years and twelve months each', async () => {
    wrap(<MonthPicker months={months} value="2026-03" onChange={() => {}} />);
    const trigger = screen.getByRole('button', { name: /March 2026/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await act(async () => fireEvent.click(trigger));
    const dialog = screen.getByRole('dialog', { name: 'Month' });
    expect(dialog.querySelectorAll('[role="group"]')).toHaveLength(2);
    expect(dialog.querySelectorAll('button')).toHaveLength(24);
    expect(screen.getByRole('button', { name: 'Mar 2026' }).getAttribute('aria-current')).toBe('date');
  });

  it('T-WEB-9 months without data are disabled; a month without a rate has the amber mark and its key', async () => {
    wrap(<MonthPicker months={months} value="2026-03" onChange={() => {}} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /March 2026/ })));
    expect((screen.getByRole('button', { name: 'Apr 2026' }) as HTMLButtonElement).disabled).toBe(true);
    const october = screen.getByRole('button', { name: 'Oct 2026' });
    expect(october.getAttribute('data-missing')).toBe('true');
    const key = document.getElementById(october.getAttribute('aria-describedby') ?? '');
    expect(key?.textContent).toBe('No dollar rate yet');
  });

  it('T-WEB-9 choosing a month reports it and closes the grid', async () => {
    const onChange = vi.fn();
    wrap(<MonthPicker months={months} value="2026-03" onChange={onChange} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /March 2026/ })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sep 2026' })));
    expect(onChange).toHaveBeenCalledWith('2026-09');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('T-WEB-9 Escape closes the grid without a choice', async () => {
    const onChange = vi.fn();
    wrap(<MonthPicker months={months} value="2026-03" onChange={onChange} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /March 2026/ })));
    await act(async () => fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('T-WEB-9 month names follow the language', () => {
    wrap(<MonthPicker months={months} value="2026-03" onChange={() => {}} />, 'es');
    expect(screen.getByRole('button', { name: /marzo de 2026/i })).toBeTruthy();
  });
});
