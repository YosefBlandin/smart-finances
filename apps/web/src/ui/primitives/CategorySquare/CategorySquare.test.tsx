// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CATEGORY_COLOURS, CategorySquare } from './CategorySquare';

afterEach(cleanup);

describe('T-WEB-9: CategorySquare (D-25, D-34)', () => {
  it('T-WEB-9 is a solid square marked with its colour number and hidden from screen readers', () => {
    const { container } = render(<CategorySquare cat={7} />);
    const square = container.firstElementChild!;
    expect(square.getAttribute('data-cat')).toBe('7');
    expect(square.getAttribute('aria-hidden')).toBe('true');
  });

  it('T-WEB-9 offers eleven category colours plus grey for Everything else; grey (cat6) is never a category', () => {
    expect(CATEGORY_COLOURS).toHaveLength(12);
    expect(CATEGORY_COLOURS).not.toContain(6);
    expect(CATEGORY_COLOURS).toContain('other');
    const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'CategorySquare.module.css'), 'utf8');
    for (const cat of CATEGORY_COLOURS) {
      const token = cat === 'other' ? '--cat6' : `--cat${cat}`;
      expect(css).toMatch(new RegExp(`\\[data-cat='${cat}'\\]\\s*\\{[^}]*var\\(${token}\\)`));
    }
  });
});
