import type { DataApi } from '@/ports/data-api';
import { dataRoute, searchValues } from '../respond';

// GET /api/data/transactions (D-127): one page of the person's transactions. Search values: from, to (yyyy-mm), kind,
// category, q (free text: sent by the browser's query only, never put in the page address, D-82), sort, order, limit,
// cursor. The data API checks them with the contracts; a refused input is 400.
export const dynamic = 'force-dynamic';

const NAMES = ['from', 'to', 'kind', 'category', 'q', 'sort', 'order', 'limit', 'cursor'] as const;

export async function GET(request: Request): Promise<Response> {
  const input = searchValues(request, NAMES) as Parameters<DataApi['listTransactions']>[1];
  return dataRoute((reads, session) => reads.listTransactions(session, input));
}
