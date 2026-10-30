// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CategoryRow } from './CategoryRow';

afterEach(cleanup);

describe('T-WEB-9: CategoryRow (D-34)', () => {
  it('T-WEB-9 a labelled list of rows, each with the solid square, the name, the amount and the share', () => {
    render(
      <CategoryRow.List label="Where it went">
        <CategoryRow cat={1} name="Housing & utilities" amount="ARS 420,000" share="38%" />
        <CategoryRow cat="other" name="Everything else" amount="ARS 90,000" />
      </CategoryRow.List>,
    );
    const list = screen.getByRole('list', { name: 'Where it went' });
    const items = screen.getAllByRole('listitem');
    expect(list.contains(items[0]!)).toBe(true);
    expect(items[0]?.querySelector('[data-cat]')?.getAttribute('data-cat')).toBe('1');
    expect(items[0]?.textContent).toContain('Housing & utilities');
    expect(items[0]?.textContent).toContain('ARS 420,000');
    expect(items[0]?.textContent).toContain('38%');
    expect(items[1]?.querySelector('[data-cat]')?.getAttribute('data-cat')).toBe('other');
  });
});
