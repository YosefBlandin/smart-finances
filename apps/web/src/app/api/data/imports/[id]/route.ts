import { getContainer } from '@/adapters/container';
import { createImports } from '@/application/data/requestImport';
import { dataRoute } from '../../respond';

// GET /api/data/imports/{id} (D-127): one import record; the browser polls it until a final status (AC-5). The read goes
// through the imports use case, which releases the person's import slot once the import is final (SF-167, D-114).
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return dataRoute((_reads, session) => createImports(getContainer()).getImport(session, id));
}
