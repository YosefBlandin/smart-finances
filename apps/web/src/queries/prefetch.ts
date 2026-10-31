import { dehydrate, QueryClient, type DehydratedState, type QueryKey } from '@tanstack/react-query';

// For server components: fetch once on the server and hand the result to <HydrationBoundary state={...}> (D-127).
// A new client per call keeps one request's data out of another's. A failed fetch is left out, so the browser retries.
export async function prefetch<T>(queryKey: QueryKey, fn: () => Promise<T>): Promise<DehydratedState> {
  const client = new QueryClient();
  await client.prefetchQuery({ queryKey, queryFn: fn, retry: false });
  return dehydrate(client);
}
