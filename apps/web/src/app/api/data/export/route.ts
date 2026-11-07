import { dataRoute, NO_STORE } from '../respond';

// GET /api/data/export (Contracts "Web routes"): every transaction as CSV, as the data API writes it (columns in the
// schema's order, review choices applied, formula-like text neutralised), sent as a download and never cached.
export const dynamic = 'force-dynamic';

const FILE_NAME = 'smart-finances-export.csv';

export async function GET(): Promise<Response> {
  return dataRoute(
    (reads, session) => reads.exportCsv(session),
    (csv) =>
      new Response(csv, {
        headers: { ...NO_STORE, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${FILE_NAME}"` },
      }),
  );
}
