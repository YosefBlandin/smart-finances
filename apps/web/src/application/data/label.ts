import type { Session } from '@/application/session';
import type { DataApi, DataApiResult } from '@/ports/data-api';
import type { Logger } from '@/ports/logger';

// A recipient label (mercadopago-enrichment D-7, D-13; Contracts "PUT /recipients/{key}/label"): one name and one
// category for every row of the signed-in person's that carries the recipient key, past and future, which also
// approves them. The data API takes the person from the access token, so a label only reaches that person's rows. The
// adapter checks the key and body with the contracts and counts the request. One log line per save: the outcome only,
// never the name or the key (AC-10); the logger refuses name, merchant and payer fields besides.

export type RecipientLabel = { key: string; name: string; category: string };
type Saved = Awaited<ReturnType<DataApi['putLabel']>> extends DataApiResult<infer T> ? T : never;

/** A failure code fit for a log line: one of the fixed lower-case codes, else failed. */
const outcomeOf = (saved: DataApiResult<unknown>): string => {
  if (saved.ok) return 'saved';
  const code = saved.code ?? saved.kind;
  return /^[a-z_]{1,40}$/.test(code) ? code : 'failed';
};

export function createLabel({ dataApi, logger }: { dataApi: DataApi; logger: Logger }) {
  return {
    async label(
      who: Pick<Session, 'sub' | 'accessToken'>,
      { key, name, category }: RecipientLabel,
      ctx: { requestId: string },
    ): Promise<DataApiResult<Saved>> {
      const saved = await dataApi.putLabel(who.accessToken, { key, name, category: category as never });
      logger.event('recipient_label', outcomeOf(saved), { sub: who.sub, requestId: ctx.requestId });
      return saved;
    },
  };
}
