import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { QueryProvider } from '@/queries/provider';
import { Shell } from '@/ui/Shell';
import { Ended } from '../consent/Ended';
import { requireMoneyAccess } from '../guarded';
import { signOutAction } from './actions';
import { Deleting } from './data/delete/Deleting';
import { readReview } from './review/read';

// The money screens share the server shell (D-137), inside the TanStack Query provider (D-127, D-130). The server-only
// guard runs here (D-108): a live session, the current consent and an active account. No consent, or an older version,
// goes to /consent (D-87, D-145); no live session shows the "session ended" screen in place (its button clears the stale
// cookie and opens sign-in with this page kept); an account being deleted shows Finish deleting in place (SF-169, AC-18),
// whose finishDeletion action finishes it and opens /goodbye. The middleware's cookie-presence
// check runs first. Each route handler and money server action runs the same guard itself (guarded() kind "money"),
// Sign out (./actions.ts) included. The to-review count (D-44) comes from the rows to review, read once per render and
// shared with the overview and the review screen (./review/read.ts); a read that fails or is past the limit shows no
// count, and the page itself decides what to show.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const access = await requireMoneyAccess();
  if (!access.ok) {
    if (access.reason === 'consent') redirect('/consent');
    if (access.reason === 'deleting') return <Deleting />;
    return <Ended why={access.reason === 'signed-out' ? access.why : undefined} />;
  }
  const stage = process.env.STAGE;
  const review = await readReview(access.session.accessToken);
  const reviewCount = review.ok ? review.data.items.length : 0;
  return (
    <QueryProvider>
      <Shell address={access.session.email} stage={stage && stage !== 'prod' ? stage : undefined} reviewCount={reviewCount} signOut={signOutAction}>
        {children}
      </Shell>
    </QueryProvider>
  );
}
