// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Field, SelectField } from './Field';

afterEach(cleanup);
// The lazily loaded part is compiled once here, so a test's first open does not wait on a cold transform
// longer than the queries' 1 s wait on a slow runner (D-190).
beforeAll(async () => {
  await import('./AriaSelectField');
}, 30_000);

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

  it('T-WEB-9 SelectField renders on the server with no style attribute (the content policy refuses one), showing its label and value', () => {
    const html = renderToString(
      <SelectField
        label="Kind"
        name="kind"
        value="income"
        hint="One kind at a time."
        options={[
          { id: 'expense', label: 'Spending' },
          { id: 'income', label: 'Income' },
        ]}
      />,
    );
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).toContain('Kind');
    expect(html).toContain('Income');
    expect(html).toContain('One kind at a time.');
    expect(html).toContain('aria-haspopup="listbox"');
    // A form still gets the value before the page has hydrated.
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="kind"[^>]*value="income"|<input[^>]*name="kind"[^>]*type="hidden"[^>]*value="income"/);
  });

  // D-190: the field is the plain markup until first use; a press or an opening key loads React Aria's select, which opens
  // with its button focused, and a choice reaches onChange.
  const kinds = [
    { id: 'expense', label: 'Spending' },
    { id: 'income', label: 'Income' },
  ] as const;

  it("T-WEB-17 SelectField stays plain markup until pressed, then opens React Aria's list and reports the choice", async () => {
    const onChange = vi.fn();
    render(<SelectField label="Kind" value="expense" onChange={onChange} options={[...kinds]} />);
    const plain = screen.getByRole('button', { name: /Kind/ });
    expect(plain.hasAttribute('data-rac')).toBe(false);
    expect(screen.queryByRole('listbox')).toBeNull();
    await act(async () => fireEvent.click(plain));
    const list = await screen.findByRole('listbox');
    const aria = screen.getByRole('button', { name: /Kind/, hidden: true });
    expect(aria.hasAttribute('data-rac')).toBe(true);
    expect(aria.getAttribute('aria-expanded')).toBe('true');
    await act(async () => fireEvent.click(screen.getByRole('option', { name: 'Income' })));
    expect(onChange).toHaveBeenCalledWith('income');
    expect(list.isConnected).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /Kind/ })));
  });

  it('T-WEB-17 SelectField opens from the keyboard with ArrowDown, and a disabled one never loads', async () => {
    render(<SelectField label="Kind" value="expense" options={[...kinds]} />);
    await act(async () => fireEvent.keyDown(screen.getByRole('button', { name: /Kind/ }), { key: 'ArrowDown' }));
    expect(await screen.findByRole('listbox')).toBeTruthy();
    cleanup();
    render(<SelectField label="Kind" value="expense" disabled options={[...kinds]} />);
    const off = screen.getByRole('button', { name: /Kind/ });
    await act(async () => fireEvent.click(off));
    await act(async () => fireEvent.keyDown(off, { key: 'ArrowDown' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(off.hasAttribute('data-rac')).toBe(false);
  });
});
