import { DeleteCommand, GetCommand, UpdateCommand, type GetCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { Account, AccountStore, Consent, ReserveRefusal } from '@/ports/account-store';
import { documentClient, type DocClient } from './sessions';

// The accounts table (architecture.md Contracts "Accounts table"; infra/lib/web-stack.ts#WebStack): pk ACCT#<sub>, on
// demand, no TTL. One item per person: consent { terms_version, privacy_version, lang, accepted_at }, status (active or
// deleting), deleting_since?, imports_today { day, n }, running_import_id?, stored_bytes (D-87, D-104, D-114). Reads are
// consistent. Every change is one UpdateCommand, and the import reservation is one conditional update: the refusal is
// decided by the condition, so two imports that race cannot both pass (D-114). running_import_bytes (not in the Contracts
// list) keeps the bytes reserved for the running import, so releaseImport can replace them with the final size. Erase-all
// resets stored_bytes and keeps the consent; delete account removes the item. Service errors are thrown.

const MiB = 1024 * 1024;
/** The per-person import caps (Contracts "Limits"): 10 a day, 200 MiB stored, 1 running. */
export const IMPORT_CAPS = { perDay: 10, storedBytes: 200 * MiB };
const ATTEMPTS = 3;

type Item = Record<string, unknown>;
type Options = { client?: DocClient; region?: string; tableName: string };

const PK = 'ACCT#';
const NAMES = {
  '#c': 'consent',
  '#s': 'status',
  '#ds': 'deleting_since',
  '#t': 'imports_today',
  '#d': 'day',
  '#n': 'n',
  '#r': 'running_import_id',
  '#rb': 'running_import_bytes',
  '#b': 'stored_bytes',
} as const;
type Alias = keyof typeof NAMES;

/** Only the aliases an expression uses: DynamoDB refuses unused names. */
const namesFor = (...aliases: Alias[]) => Object.fromEntries(aliases.map((a) => [a, NAMES[a]]));

const str = (v: unknown): v is string => typeof v === 'string';
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const conditionFailed = (e: unknown) => e instanceof Error && e.name === 'ConditionalCheckFailedException';

function toConsent(v: unknown): Consent | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const { terms_version, privacy_version, lang, accepted_at } = v as Item;
  if (!str(terms_version) || !str(privacy_version) || (lang !== 'en' && lang !== 'es') || !num(accepted_at)) return undefined;
  return { termsVersion: terms_version, privacyVersion: privacy_version, lang, acceptedAt: accepted_at };
}

/** The item as an Account; a malformed consent reads as none, so the consent screen asks again. */
function toAccount(sub: string, item: Item): Account {
  const account: Account = {
    sub,
    status: item.status === 'deleting' ? 'deleting' : 'active',
    storedBytes: num(item.stored_bytes) ? item.stored_bytes : 0,
  };
  const consent = toConsent(item.consent);
  if (consent) account.consent = consent;
  if (num(item.deleting_since)) account.deletingSince = item.deleting_since;
  const today = item.imports_today as Item | undefined;
  if (today && str(today.day) && num(today.n)) account.importsToday = { day: today.day, n: today.n };
  if (str(item.running_import_id)) account.runningImportId = item.running_import_id;
  return account;
}

export class DynamoAccountStore implements AccountStore {
  private readonly client: DocClient;
  private readonly table: string;

  constructor(opts: Options) {
    this.client = opts.client ?? documentClient(opts.region);
    this.table = opts.tableName;
  }

  private key(sub: string) {
    return { pk: PK + sub };
  }

  private async item(sub: string): Promise<Item | undefined> {
    const out = (await this.client.send(new GetCommand({ TableName: this.table, Key: this.key(sub), ConsistentRead: true }))) as GetCommandOutput;
    return out.Item;
  }

  /** One update; false when its condition failed. */
  private async update(sub: string, expr: { update: string; condition?: string; names: Alias[]; values: Item }): Promise<boolean> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.table,
          Key: this.key(sub),
          UpdateExpression: expr.update,
          ...(expr.condition ? { ConditionExpression: expr.condition } : {}),
          ExpressionAttributeNames: namesFor(...expr.names),
          ExpressionAttributeValues: expr.values,
        }),
      );
      return true;
    } catch (e) {
      if (conditionFailed(e)) return false;
      throw e;
    }
  }

  async getAccount(sub: string): Promise<Account | undefined> {
    const item = await this.item(sub);
    return item && toAccount(sub, item);
  }

  /** Writes the consent; a new item starts active with zero bytes. An existing status (deleting) is kept. */
  async putConsent(sub: string, consent: Consent) {
    await this.update(sub, {
      update: 'SET #c = :consent, #s = if_not_exists(#s, :active), #b = if_not_exists(#b, :zero)',
      names: ['#c', '#s', '#b'],
      values: {
        ':consent': {
          terms_version: consent.termsVersion,
          privacy_version: consent.privacyVersion,
          lang: consent.lang,
          accepted_at: consent.acceptedAt,
        },
        ':active': 'active',
        ':zero': 0,
      },
    });
  }

  /** Idempotent: a second call keeps the first deleting_since, so the 6-hour alarm counts from the start (D-104). */
  async markDeleting(sub: string, now: number) {
    await this.update(sub, {
      update: 'SET #s = :deleting, #ds = if_not_exists(#ds, :now), #b = if_not_exists(#b, :zero)',
      names: ['#s', '#ds', '#b'],
      values: { ':deleting': 'deleting', ':now': now, ':zero': 0 },
    });
  }

  /**
   * Reserves one import: under 10 today, no import running, and the stored bytes plus this file within 200 MiB. The
   * read only picks the refusal to report and which update to try (same day or a new day); the update's condition alone
   * decides, so a concurrent change makes it fail and the next attempt reads again.
   */
  async reserveImport(sub: string, { day, bytes, importId }: { day: string; bytes: number; importId: string }) {
    const refuse = (reason: ReserveRefusal) => ({ ok: false as const, reason });
    if (bytes > IMPORT_CAPS.storedBytes) return refuse('bytes');
    const room = IMPORT_CAPS.storedBytes - bytes;
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const item = (await this.item(sub)) ?? {};
      const account = toAccount(sub, item);
      const sameDay = account.importsToday?.day === day;
      if (account.runningImportId !== undefined) return refuse('running');
      if (sameDay && account.importsToday!.n >= IMPORT_CAPS.perDay) return refuse('daily');
      if (num(item.stored_bytes) && item.stored_bytes > room) return refuse('bytes');
      const done = sameDay
        ? await this.update(sub, {
            update: 'SET #t.#n = #t.#n + :one, #r = :id, #rb = :bytes, #b = #b + :bytes',
            condition: '#t.#d = :day AND #t.#n < :perDay AND attribute_not_exists(#r) AND #b <= :room',
            names: ['#t', '#d', '#n', '#r', '#rb', '#b'],
            values: { ':one': 1, ':id': importId, ':bytes': bytes, ':day': day, ':perDay': IMPORT_CAPS.perDay, ':room': room },
          })
        : await this.update(sub, {
            update: 'SET #t = :today, #r = :id, #rb = :bytes, #b = if_not_exists(#b, :zero) + :bytes, #s = if_not_exists(#s, :active)',
            condition: '(attribute_not_exists(#t) OR #t.#d <> :day) AND attribute_not_exists(#r) AND (attribute_not_exists(#b) OR #b <= :room)',
            names: ['#t', '#d', '#r', '#rb', '#b', '#s'],
            values: { ':today': { day, n: 1 }, ':id': importId, ':bytes': bytes, ':zero': 0, ':active': 'active', ':day': day, ':room': room },
          });
      if (done) return { ok: true as const };
    }
    // Still contended after three reads: another import is being reserved at this moment.
    return refuse('running');
  }

  /** Ends the running import with its final size in place of the reserved bytes; another import id changes nothing. */
  async releaseImport(sub: string, importId: string, finalBytes: number) {
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const item = await this.item(sub);
      if (!item || item.running_import_id !== importId) return;
      const stored = num(item.stored_bytes) ? item.stored_bytes : 0;
      const reserved = num(item.running_import_bytes) ? item.running_import_bytes : 0;
      const done = await this.update(sub, {
        update: 'SET #b = :next REMOVE #r, #rb',
        condition: '#r = :id AND #b = :stored',
        names: ['#b', '#r', '#rb'],
        values: { ':next': Math.max(0, stored - reserved + finalBytes), ':id': importId, ':stored': stored },
      });
      if (done) return;
    }
    throw new Error('releaseImport: the account item kept changing');
  }

  /** Erase-all: stored_bytes back to 0; the consent, status and counts stay. No item, no change. */
  async resetStoredBytes(sub: string) {
    await this.update(sub, { update: 'SET #b = :zero', condition: 'attribute_exists(pk)', names: ['#b'], values: { ':zero': 0 } });
  }

  /** Delete account, last step: the item and its consent go. */
  async deleteAccountRow(sub: string) {
    await this.client.send(new DeleteCommand({ TableName: this.table, Key: this.key(sub) }));
  }
}
