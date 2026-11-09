import { randomUUID } from 'node:crypto';
import { getContainer } from '@/adapters/container';

// Deploy check: which commit is running, on which stage. Reads only its own two settings and never caches (D-71, D-110).
// Until the settings module arrives with the web server PR, STAGE=test supplies defaults so tests and e2e need no setup.
// Each answer writes one health line, which the hourly job's call turns into the heartbeat alarm's metric (D-107).
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(): Promise<Response> {
  const test = process.env.STAGE === 'test';
  const stage = process.env.STAGE || undefined;
  const sha = process.env.COMMIT_SHA || (test ? 'test' : undefined);
  if (!stage || !sha) {
    return Response.json({ error: { code: 'not_configured', message: 'Server settings are missing.' } }, { status: 500, headers: NO_STORE });
  }
  // The answer never depends on the log: a logger that cannot be built leaves the heartbeat to alarm instead.
  try {
    getContainer().logger.event('health', 'ok', { requestId: randomUUID() });
  } catch {
    // The heartbeat alarm reports a missing line; the deploy check still answers.
  }
  return Response.json({ sha, stage }, { headers: NO_STORE });
}
