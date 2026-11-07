// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ICON_NAMES, Icon } from './Icon';

afterEach(cleanup);

describe('T-WEB-9: Icon (Tabler outline at 2px, D-17, D-58)', () => {
  it('T-WEB-9 is decorative by default: hidden from screen readers, 2px stroke, sized by token', () => {
    const { container } = render(<Icon name="calendar" size="lg" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('stroke-width')).toBe('2');
    expect(svg.getAttribute('width')).toBe('18');
    expect(svg.getAttribute('data-icon')).toBe('calendar');
  });

  it('T-WEB-9 with a label it is an image with that name', () => {
    render(<Icon name="failed" label="Failed" />);
    expect(screen.getByRole('img', { name: 'Failed' })).toBeTruthy();
  });

  it('T-WEB-9 every name renders a bundled Tabler icon', () => {
    for (const name of ICON_NAMES) {
      const { container } = render(<Icon name={name} />);
      expect(container.querySelector('svg')?.getAttribute('class'), name).toMatch(/tabler-icon/);
      cleanup();
    }
  });
});
