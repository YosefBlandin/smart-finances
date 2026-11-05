import type { DataApi } from '@/ports/data-api';
import { dataRoute, searchValues } from '../respond';

// GET /api/data/totals (D-127): month totals for from..to (yyyy-mm) in the native or the dollar view (view).
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const input = searchValues(request, ['from', 'to', 'view'] as const) as Parameters<DataApi['totals']>[1];
  return dataRoute((reads, session) => reads.getTotals(session, input));
}
