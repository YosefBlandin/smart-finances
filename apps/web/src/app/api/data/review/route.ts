import { dataRoute } from '../respond';

// GET /api/data/review (D-127): the rows to review, with their reasons.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return dataRoute((reads, session) => reads.getReview(session));
}
