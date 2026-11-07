// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

afterEach(cleanup);

describe('T-WEB-9: Button', () => {
  it('T-WEB-9 renders variant and size as data attributes and is a plain button by default', () => {
    render(
      <Button variant="primary" size="sm">
        Continue
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Continue' });
    expect(button.getAttribute('data-variant')).toBe('primary');
    expect(button.getAttribute('data-size')).toBe('sm');
    expect(button.getAttribute('type')).toBe('button');
  });

  it('T-WEB-9 forwards its ref to the button element', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Save</Button>);
    expect(ref.current?.tagName).toBe('BUTTON');
  });

  it('T-WEB-9 a busy submit button does not submit its form again', () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" busy>
          Create account
        </Button>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('T-WEB-9 a disabled button is disabled and an icon sits beside the word, hidden from screen readers', () => {
    render(
      <Button icon="download" disabled>
        Download CSV
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Download CSV' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
