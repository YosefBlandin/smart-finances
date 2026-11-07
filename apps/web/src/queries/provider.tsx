'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useState, type ReactNode } from 'react';

// Data counts as fresh for 30 seconds, so hydrated server data is shown without a second request (D-130).
export const STALE_TIME_MS = 30_000;

// Devtools load only in development; the production bundle never includes them (D-130).
const Devtools =
  process.env.NODE_ENV === 'development'
    ? lazy(() => import('@tanstack/react-query-devtools').then((m) => ({ default: m.ReactQueryDevtools })))
    : null;

export function QueryProvider({ children }: { children: ReactNode }) {
  // One client per browser tab, made once, so a re-render never drops the cache.
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: STALE_TIME_MS } } }));
  return (
    <QueryClientProvider client={client}>
      {children}
      {Devtools && (
        <Suspense fallback={null}>
          <Devtools initialIsOpen={false} />
        </Suspense>
      )}
    </QueryClientProvider>
  );
}
