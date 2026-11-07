// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Chip } from './Chip';

afterEach(cleanup);

describe('T-WEB-9: Chip', () => {
  it.each(['ok', 'running', 'warn', 'failed', 'idle'] as const)('T-WEB-9 tone %s is a data attribute with an icon beside the word', (tone) => {
    render(<Chip tone={tone}>Status</Chip>);
    const chip = screen.getByText('Status').closest('[data-tone]');
    expect(chip?.getAttribute('data-tone')).toBe(tone);
    expect(chip?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
