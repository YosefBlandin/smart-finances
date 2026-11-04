import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { QueryProvider } from '@/queries/provider';
import { Shell } from '@/ui/Shell';
import { Ended } from '../consent/Ended';
import { requireMoneyAccess } from '../guarded';

// The money screens share the server shell (D-137), inside the TanStack Query provider (D-127, D-130). The server-only
// guard runs here (D-108): a live session, the current consent and an active account. No consent, or an older version,
// goes to /consent (D-87, D-145); no live session, or an account being deleted, shows the "session ended" screen in
// place (its button clears the stale cookie and opens sign-in with this page kept). The middleware's cookie-presence
// check runs first. Each route handler and money server action runs the same guard itself (guarded() kind "money").
export default async function AppLayout({ children }: { children: ReactNode }) {
  const access = await requireMoneyAccess();
  if (!access.ok) {
    if (access.reason === 'consent') redirect('/consent');
    return <Ended why={access.reason === 'signed-out' ? access.why : undefined} />;
  }
  const stage = process.env.STAGE;
  return (
    <QueryProvider>
      <Shell address={access.session.email} stage={stage && stage !== 'prod' ? stage : undefined} reviewCount={0}>
        {children}
      </Shell>
    </QueryProvider>
  );
}
