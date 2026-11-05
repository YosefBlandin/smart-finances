import { dataRoute } from '../respond';

// GET /api/data/rates (D-127): the person's dollar rates by month.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return dataRoute((reads, session) => reads.getRates(session));
}
