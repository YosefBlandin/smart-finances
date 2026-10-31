// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import en from '../../../../messages/en.json';
import { MenuPanel } from './MenuPanel';

afterEach(cleanup);

const wrap = (ui: ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );

describe('T-WEB-9: MenuPanel (D-43, D-44)', () => {
  it('T-WEB-9 the button names the screen, carries the review count and opens the panel with a close mark', async () => {
    wrap(
      <MenuPanel label="Overview" count={3} countLabel="3 to review">
        {() => <a href="/transactions">Transactions</a>}
      </MenuPanel>,
    );
    const button = screen.getByRole('button', { name: /Overview/ });
    expect(button.textContent).toContain('3');
    expect(button.textContent).toContain('3 to review');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.querySelector('[data-icon="menu"]')).not.toBeNull();
    await act(async () => fireEvent.click(button));
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.querySelector('[data-icon="close"]')).not.toBeNull();
    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Transactions' })).toBeTruthy();
  });

  it('T-WEB-9 Escape closes the panel, and so does the close function passed to the content', async () => {
    wrap(
      <MenuPanel label="Overview">
        {(close) => (
          <button type="button" onClick={close}>
            Imports
          </button>
        )}
      </MenuPanel>,
    );
    const button = screen.getByRole('button', { name: 'Overview' });
    await act(async () => fireEvent.click(button));
    await act(async () => fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => fireEvent.click(button));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Imports' })));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('T-WEB-9 without a count the button shows no count', () => {
    wrap(<MenuPanel label="Your data">{() => null}</MenuPanel>);
    expect(screen.getByRole('button', { name: 'Your data' }).querySelector('[data-count]')).toBeNull();
  });
});
