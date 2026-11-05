import { createPow } from '@/application/pow';
import { createContainer } from '@/adapters/container';

// GET /api/auth/pow (Contracts "Web routes"; D-120, D-125): a fresh proof-of-work challenge for anyone, never cached.
// It changes no state: the answer is claimed once when guarded() checks the post. If the challenge cannot be issued
// (no settings or secret), the reply says so plainly with no detail.
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(): Promise<Response> {
  try {
    const challenge = await createPow(createContainer()).issue();
    return Response.json(challenge, { headers: NO_STORE });
  } catch {
    return Response.json({ error: { code: 'unavailable', message: 'Reload and try again.' } }, { status: 503, headers: NO_STORE });
  }
}
