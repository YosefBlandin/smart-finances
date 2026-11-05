import { dataRoute } from '../../respond';

// GET /api/data/imports/{id} (D-127): one import record; the browser polls it until a final status (AC-5).
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return dataRoute((reads, session) => reads.getImport(session, id));
}
