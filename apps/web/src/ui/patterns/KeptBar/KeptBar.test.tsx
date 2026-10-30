// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { KeptBar } from './KeptBar';

afterEach(cleanup);

describe('T-WEB-9: KeptBar (D-26, D-27)', () => {
  it('T-WEB-9 a good month: one image with its sentence, the kept part solid at the right end, the typical marker', () => {
    render(
      <KeptBar
        field="good"
        label="You spent 68% of what you earned and kept 32%."
        solid={0.32}
        marker={0.8}
        markerLabel="Typical keeps 20%"
        start={{ label: 'Spent', value: '68%' }}
        end={{ label: 'Kept', value: '32%' }}
      />,
    );
    const bar = screen.getByRole('img', { name: 'You spent 68% of what you earned and kept 32%.' });
    expect(bar.getAttribute('data-field')).toBe('good');
    const solid = bar.querySelector('[data-part="solid"]')!;
    expect(solid.getAttribute('x')).toBe('68%');
    expect(solid.getAttribute('width')).toBe('32%');
    expect(bar.querySelector('[data-part="marker"]')?.getAttribute('x1')).toBe('80%');
    expect(bar.textContent).toContain('Typical keeps 20%');
  });

  it('T-WEB-9 the marker label sits to the right of a marker in the left half', () => {
    render(
      <KeptBar
        field="bad"
        label="Over"
        solid={0.6}
        marker={0.4}
        markerLabel="Earnings ran out here"
        start={{ label: 'Spent', value: '' }}
        end={{ label: 'Over by', value: 'USD 1.00' }}
      />,
    );
    const text = screen.getByText('Earnings ran out here').closest('text')!;
    expect(text.getAttribute('text-anchor')).toBe('start');
  });

  it('T-WEB-9 shares are clamped to the bar and no marker is drawn without one', () => {
    render(<KeptBar field="good" label="Kept all" solid={1.4} start={{ label: 'Spent', value: '0%' }} end={{ label: 'Kept', value: '100%' }} />);
    const bar = screen.getByRole('img', { name: 'Kept all' });
    expect(bar.querySelector('[data-part="solid"]')?.getAttribute('width')).toBe('100%');
    expect(bar.querySelector('[data-part="marker"]')).toBeNull();
  });
});
