import { redirect } from 'next/navigation';
import { safeNext } from '@/application/auth/signIn';
import { clearSessionCookie } from '../../../cookies';
import { requireMoneyAccess } from '../../../guarded';

// GET /api/data/signed-out?next=<address> (architecture "Screen states": signed out, to sign-in with the path kept;
// "Data access": 401, one refresh, then signed out). A money page's prefetch (redirectIfStopped in ../respond.ts) or a
// browser read (getJson in queries/data.ts) that meets a refused token comes here once the session has ended. The
// middleware sends /sign-in back to the overview while __Host-sid is set, and only a route handler or an action may
// clear a cookie, so this clears it and opens /sign-in?next=<address>. A session that is still live is left alone and
// goes back to the address: a link to this route can never sign anyone out (no GET ends a session, Contracts "Cookies").
// next is kept only when it is a money screen's address (safeNext, the sign-in screen's own rule).
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<never> {
  const asked = new URL(request.url).searchParams.get('next') ?? undefined;
  const next = safeNext(asked);
  const keep = asked !== undefined && next === asked;
  const access = await requireMoneyAccess();
  if (access.ok || access.reason !== 'signed-out') redirect(next);
  await clearSessionCookie();
  redirect(keep && next !== '/overview' ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in');
}
