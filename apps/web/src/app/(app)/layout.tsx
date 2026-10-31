import type { ReactNode } from 'react';
import { QueryProvider } from '@/queries/provider';
import { Shell } from '@/ui/Shell';

// Synthetic: PR 3 shows the signed-in person's address from the session.
const PLACEHOLDER_ADDRESS = 'you@example.com';

// The money screens share the server shell (D-137), inside the TanStack Query provider (D-127, D-130). PR 3 adds the
// server-only guard here (D-108); until then the middleware's cookie-presence check is the only gate.
export default function AppLayout({ children }: { children: ReactNode }) {
  const stage = process.env.STAGE;
  return (
    <QueryProvider>
      <Shell address={PLACEHOLDER_ADDRESS} stage={stage && stage !== 'prod' ? stage : undefined} reviewCount={0}>
        {children}
      </Shell>
    </QueryProvider>
  );
}
