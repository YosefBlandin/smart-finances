import type { Session } from '@/application/session';
import type { DataApi, DataApiResult } from '@/ports/data-api';

// A month's dollar rate (D-131; data spec PUT /rates/{month}): pesos per dollar, above 0, with at most two decimals, for
// the signed-in person only (the API takes the person from the access token, AC-15).

type Saved = Awaited<ReturnType<DataApi['putRate']>> extends DataApiResult<infer T> ? T : never;

/** True for a rate the API takes: a finite number above 0 with at most two decimals. */
export function isRate(value: number): boolean {
  return Number.isFinite(value) && value > 0 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

export function createSetRate({ dataApi }: { dataApi: DataApi }) {
  return {
    setRate: (who: Pick<Session, 'accessToken'>, month: string, arsPerUsd: number): Promise<DataApiResult<Saved>> =>
      dataApi.putRate(who.accessToken, { month, ars_per_usd: arsPerUsd }),
  };
}
