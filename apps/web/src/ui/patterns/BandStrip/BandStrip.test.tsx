// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BandStrip } from './BandStrip';

afterEach(cleanup);

const bands = [
  { cat: 1, share: 0.5, name: 'Housing & utilities' },
  { cat: 3, share: 0.3, name: 'Groceries' },
  { cat: 'other', share: 0.2, name: 'Everything else' },
] as const;

describe('T-WEB-9: BandStrip (D-15, D-25)', () => {
  it('T-WEB-9 is one labelled image with a band per category, as wide as its share and in order', () => {
    render(<BandStrip label="This month’s spending" bands={[...bands]} />);
    const strip = screen.getByRole('img', { name: 'This month’s spending' });
    const rects = [...strip.querySelectorAll('[data-cat]')];
    expect(rects.map((r) => r.getAttribute('data-cat'))).toEqual(['1', '3', 'other']);
    expect(rects.map((r) => r.getAttribute('x'))).toEqual(['0%', '50%', '80%']);
    expect(rects.map((r) => r.getAttribute('width'))).toEqual(['50%', '30%', '20%']);
    expect(rects[1]?.querySelector('title')?.textContent).toBe('Groceries');
  });

  it('T-WEB-9 shares that do not add up to one are scaled to fill the strip', () => {
    render(
      <BandStrip
        label="Strip"
        bands={[
          { cat: 2, share: 2, name: 'A' },
          { cat: 4, share: 2, name: 'B' },
        ]}
      />,
    );
    const widths = [...screen.getByRole('img').querySelectorAll('[data-cat]')].map((r) => r.getAttribute('width'));
    expect(widths).toEqual(['50%', '50%']);
  });
});
