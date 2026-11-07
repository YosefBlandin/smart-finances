import type { Session } from '@/application/session';
import type { DataApi } from '@/ports/data-api';

// The read use cases behind the JSON routes /api/data/* and the server prefetch (AC-6, AC-15; D-127, D-82). The person
// is always the signed-in session's: its access token goes to the data API, which takes the person from the token
// (data spec "Identity"), so nothing in a request's address or body can name another person. The adapter checks the
// input with the contracts, counts the request against the person's limit and parses the reply (SF-161); these return
// its answer as is, so a route and a server render handle limited, not found and failed the same way.

export type DataReadsDeps = { dataApi: DataApi };
type Input<M extends keyof DataApi> = Parameters<DataApi[M]>[1];
type Who = Pick<Session, 'accessToken'>;

export function createDataReads({ dataApi }: DataReadsDeps) {
  return {
    /** One page of transactions: a month range, filters, free text, sort and the cursor. */
    listTransactions: (who: Who, input: Input<'listTransactions'>) => dataApi.listTransactions(who.accessToken, input),
    /** Month totals for a range, in the native or the dollar view. */
    getTotals: (who: Who, input: Input<'totals'>) => dataApi.totals(who.accessToken, input),
    getRates: (who: Who) => dataApi.rates(who.accessToken, {}),
    /** The rows to review. */
    getReview: (who: Who) => dataApi.review(who.accessToken, {}),
    listImports: (who: Who, input: Input<'listImports'>) => dataApi.listImports(who.accessToken, input),
    getImport: (who: Who, id: string) => dataApi.getImport(who.accessToken, { id }),
    /** The CSV of every transaction, review choices applied, formula-like text neutralised by the API. */
    exportCsv: (who: Who) => dataApi.exportCsv(who.accessToken, {}),
  };
}

export type DataReads = ReturnType<typeof createDataReads>;
