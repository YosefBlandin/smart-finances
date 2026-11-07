import { dataRoute, searchValues } from '../respond';

// GET /api/data/imports (D-127): the person's imports, newest first, paged by the API's cursor.
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const input = searchValues(request, ['cursor'] as const);
  return dataRoute((reads, session) => reads.listImports(session, input));
}
