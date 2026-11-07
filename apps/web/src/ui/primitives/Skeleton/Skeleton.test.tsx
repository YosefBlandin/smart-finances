// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Skeleton } from './Skeleton';

afterEach(cleanup);

describe('T-WEB-9: Skeleton', () => {
  it('T-WEB-9 is hidden from screen readers and sized through data attributes', () => {
    const { container } = render(<Skeleton width="half" height="title" />);
    const bone = container.firstElementChild!;
    expect(bone.getAttribute('aria-hidden')).toBe('true');
    expect(bone.getAttribute('data-width')).toBe('half');
    expect(bone.getAttribute('data-height')).toBe('title');
  });

  it('T-WEB-9 defaults to a full-width line of text', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild?.getAttribute('data-width')).toBe('full');
    expect(container.firstElementChild?.getAttribute('data-height')).toBe('text');
  });
});
