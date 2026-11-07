import type { Session } from '@/application/session';
import type { DataApi, DataApiResult } from '@/ports/data-api';

// A review choice (D-131; data spec PUT /transactions/{id}/review): a category, an approval, or both, for one row of
// the signed-in person's. The row is named by its id and date; the data API takes the person from the access token, so
// a choice can only reach that person's own rows (AC-15), and refuses rows of a source other than Mercado Pago
// (source_file_only). The adapter checks the input with the contracts and counts the request (SF-161).

export type ReviewChoice = { id: string; date: string; category?: string; approved?: boolean };
type Saved = Awaited<ReturnType<DataApi['putReview']>> extends DataApiResult<infer T> ? T : never;

export function createReview({ dataApi }: { dataApi: DataApi }) {
  return {
    choose: (who: Pick<Session, 'accessToken'>, { id, date, category, approved }: ReviewChoice): Promise<DataApiResult<Saved>> =>
      dataApi.putReview(who.accessToken, {
        id,
        date,
        ...(category !== undefined ? { category } : {}),
        ...(approved !== undefined ? { approved } : {}),
      }),
  };
}
