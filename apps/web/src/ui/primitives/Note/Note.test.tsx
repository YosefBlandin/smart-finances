// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Note } from './Note';

afterEach(cleanup);

describe('T-WEB-9: Note', () => {
  it('T-WEB-9 an error note carries its tone, a title and the text', () => {
    render(
      <Note tone="error" title="This import stopped partway.">
        Repair finishes it from the file already uploaded.
      </Note>,
    );
    const note = screen.getByText('This import stopped partway.').closest('[data-tone]');
    expect(note?.getAttribute('data-tone')).toBe('error');
    expect(note?.textContent).toContain('Repair finishes it');
  });

  it('T-WEB-9 the default tone is info and the role is only set when asked for', () => {
    render(<Note>Plain</Note>);
    const note = screen.getByText('Plain').closest('[data-tone]');
    expect(note?.getAttribute('data-tone')).toBe('info');
    expect(note?.getAttribute('role')).toBeNull();
    cleanup();
    render(
      <Note tone="error" role="alert">
        Wrong
      </Note>,
    );
    expect(screen.getByRole('alert').textContent).toContain('Wrong');
  });
});
