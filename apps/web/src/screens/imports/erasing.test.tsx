// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import es from '../../../messages/es.json';
import { Imports, type RequestResult } from './Imports';

// An import refused during the quiet window after a delete-all says the data was just deleted and when imports open
// again (the API's Retry-After, as retryAfterSeconds); with no wait known, it says the delete is still running.

const NOW = Date.parse('2026-11-15T15:04:00Z');

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function refuse(locale: 'en' | 'es', result: RequestResult) {
  vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true });
  vi.stubGlobal('fetch', async () => Response.json({ items: [] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale={locale} messages={locale === 'es' ? es : en} timeZone="UTC">
        <Imports request={async () => result} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['DATE;SOURCE_ID\n'], 'release-2026-10.csv', { type: 'text/csv' });
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
  return screen.findByRole('alert');
}

describe('an import refused right after a delete-all', () => {
  it.each([
    ['en', 'en-US', /just deleted/i],
    ['es', 'es-AR', /acabas de borrar/i],
  ] as const)('%s: says the data was just deleted and when imports open again', async (locale, intl, text) => {
    const alert = await refuse(locale, { ok: false, messageKey: 'imports.refused.erasing', retryAfterSeconds: 40 * 60 });
    // The time is the person's own clock, so the test words it with the same formatter in this machine's time zone.
    const at = new Intl.DateTimeFormat(intl, { timeStyle: 'short' }).format(new Date(NOW + 40 * 60_000));
    expect(alert.textContent).toMatch(text);
    expect(alert.textContent).toContain(at);
  });

  it.each([
    ['en', /still being deleted/i],
    ['es', /todavía se están borrando/i],
  ] as const)('%s: with no wait known, says the delete is still running', async (locale, text) => {
    const alert = await refuse(locale, { ok: false, messageKey: 'imports.refused.erasing' });
    expect(alert.textContent).toMatch(text);
  });
});
