// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Field, SelectField } from './Field';

afterEach(cleanup);

describe('T-WEB-9: Field', () => {
  it('T-WEB-9 the label names the input and changes reach onChange as text', () => {
    const onChange = vi.fn();
    render(<Field label="Password" type="password" onChange={onChange} />);
    const input = screen.getByLabelText('Password');
    expect(input.getAttribute('type')).toBe('password');
    fireEvent.change(input, { target: { value: 'a long phrase' } });
    expect(onChange).toHaveBeenCalledWith('a long phrase');
  });

  it('T-WEB-9 the error is a red note with an icon, tied to the input; the field marks itself invalid', () => {
    const { container } = render(<Field label="Code" error="That code doesn’t match." />);
    const input = screen.getByLabelText('Code');
    const errorId = input.getAttribute('aria-describedby');
    const error = document.getElementById(errorId ?? '');
    expect(error?.textContent).toBe('That code doesn’t match.');
    expect(error?.querySelector('svg')).not.toBeNull();
    expect(container.firstElementChild?.getAttribute('data-invalid')).toBe('true');
  });

  it('T-WEB-9 forwards its ref to the input', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Field ref={ref} label="Email" />);
    expect(ref.current?.tagName).toBe('INPUT');
  });

  it('T-WEB-9 SelectField is a labelled React Aria select whose error is described', () => {
    render(
      <SelectField
        label="Kind"
        value="expense"
        error="Pick a kind."
        options={[
          { id: 'expense', label: 'expense' },
          { id: 'income', label: 'income' },
        ]}
      />,
    );
    const trigger = screen.getByRole('button', { name: /Kind/ });
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    const described = (trigger.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described).toContain('Pick a kind.');
  });
});
