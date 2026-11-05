import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type GetCommandOutput,
  type QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import type { Clock } from '@/ports/clock';
import type { PreAuthRow, PreAuthStore } from '@/ports/pre-auth-store';
import type { SessionRow, SessionStore } from '@/ports/session-store';

// The sessions table (architecture.md Contracts "Sessions table"; infra/lib/web-stack.ts#WebStack): pk only, TTL on
// expires_at, a keys-only bySub index on sub. Session items are SID#<sha256 of the cookie id>, pre-auth items
// PRE#<sha256 of the cookie id>; the cookie id itself is never stored. expires_at is in epoch seconds, as the TTL
// needs, rounded down so a row never outlives the policy; created_at and last_seen_at are epoch milliseconds. Every
// read checks expires_at against the clock itself (the TTL may lag by days) and reads consistently, so a sign-out is
// seen at once. Expected misses return undefined or false; service errors are thrown, never read as a missing row.

type AnyCommand = DeleteCommand | GetCommand | PutCommand | QueryCommand | UpdateCommand;

/** The calls these adapters make; tests pass a hand-written fake. */
export type DocClient = { send(command: AnyCommand): Promise<object> };

type Options = { client?: DocClient; region?: string; tableName: string; clock: Clock };
type Item = Record<string, unknown>;

const SID = 'SID#';
const PRE = 'PRE#';
const BY_SUB = 'bySub';

export function documentClient(region?: string): DocClient {
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region }), { marshallOptions: { removeUndefinedValues: true } });
}

const seconds = (ms: number) => Math.floor(ms / 1000);
const str = (v: unknown): v is string => typeof v === 'string';
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const conditionFailed = (e: unknown) => e instanceof Error && e.name === 'ConditionalCheckFailedException';

abstract class TableStore {
  protected readonly client: DocClient;
  protected readonly table: string;
  protected readonly clock: Clock;

  constructor(opts: Options) {
    this.client = opts.client ?? documentClient(opts.region);
    this.table = opts.tableName;
    this.clock = opts.clock;
  }

  /** The live item under pk, or undefined when absent or past its expires_at. */
  protected async read(pk: string): Promise<Item | undefined> {
    const out = (await this.client.send(new GetCommand({ TableName: this.table, Key: { pk }, ConsistentRead: true }))) as GetCommandOutput;
    const item = out.Item;
    if (!item || !num(item.expires_at) || item.expires_at * 1000 <= this.clock.now()) return undefined;
    return item;
  }

  protected async remove(pk: string) {
    await this.client.send(new DeleteCommand({ TableName: this.table, Key: { pk } }));
  }

  /** SET the defined values and REMOVE the undefined ones, only on a live item; false when there is none. */
  protected async patch(pk: string, fields: Item): Promise<boolean> {
    const names: Record<string, string> = {};
    const values: Item = { ':now': seconds(this.clock.now()) };
    const set: string[] = [];
    const drop: string[] = [];
    for (const [attr, value] of Object.entries(fields)) {
      names[`#${attr}`] = attr;
      if (value === undefined) drop.push(`#${attr}`);
      else {
        values[`:${attr}`] = value;
        set.push(`#${attr} = :${attr}`);
      }
    }
    const expression = [set.length ? `SET ${set.join(', ')}` : '', drop.length ? `REMOVE ${drop.join(', ')}` : ''].filter(Boolean).join(' ');
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { pk },
          UpdateExpression: expression,
          ConditionExpression: 'attribute_exists(pk) AND expires_at > :now',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }),
      );
      return true;
    } catch (e) {
      if (conditionFailed(e)) return false;
      throw e;
    }
  }
}

function toSessionRow(item: Item): SessionRow | undefined {
  const { pk, sub, access_token, id_token, refresh_token, created_at, last_seen_at, expires_at } = item;
  if (!str(pk) || !pk.startsWith(SID) || !str(sub) || !str(access_token) || !str(id_token) || !str(refresh_token)) return undefined;
  if (!num(created_at) || !num(last_seen_at) || !num(expires_at)) return undefined;
  return {
    idHash: pk.slice(SID.length),
    sub,
    accessToken: access_token,
    idToken: id_token,
    refreshToken: refresh_token,
    createdAt: created_at,
    lastSeenAt: last_seen_at,
    expiresAt: expires_at * 1000,
  };
}

export class DynamoSessionStore extends TableStore implements SessionStore {
  async create(row: SessionRow) {
    await this.client.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          pk: SID + row.idHash,
          sub: row.sub,
          access_token: row.accessToken,
          id_token: row.idToken,
          refresh_token: row.refreshToken,
          created_at: row.createdAt,
          last_seen_at: row.lastSeenAt,
          expires_at: seconds(row.expiresAt),
        },
      }),
    );
  }

  async get(idHash: string) {
    const item = await this.read(SID + idHash);
    return item && toSessionRow(item);
  }

  async touch(idHash: string, now: number) {
    return this.patch(SID + idHash, { last_seen_at: now });
  }

  async delete(idHash: string) {
    await this.remove(SID + idHash);
  }

  /** The id hashes of every session item of a person, from the keys-only bySub index (eventually consistent). */
  private async hashesBySub(sub: string): Promise<string[]> {
    const hashes: string[] = [];
    let start: Item | undefined;
    do {
      const out = (await this.client.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: BY_SUB,
          KeyConditionExpression: '#sub = :sub',
          ExpressionAttributeNames: { '#sub': 'sub' },
          ExpressionAttributeValues: { ':sub': sub },
          ExclusiveStartKey: start,
        }),
      )) as QueryCommandOutput;
      for (const item of out.Items ?? []) if (str(item.pk) && item.pk.startsWith(SID)) hashes.push(item.pk.slice(SID.length));
      start = out.LastEvaluatedKey;
    } while (start);
    return hashes;
  }

  async listBySub(sub: string) {
    const rows: SessionRow[] = [];
    for (const hash of await this.hashesBySub(sub)) {
      const row = await this.get(hash);
      if (row?.sub === sub) rows.push(row);
    }
    return rows;
  }

  /** Removes expired items too, so nothing of the person waits for the TTL. */
  async deleteBySub(sub: string) {
    const hashes = await this.hashesBySub(sub);
    for (const hash of hashes) await this.remove(SID + hash);
    return hashes.length;
  }
}

// PreAuthRow field → attribute name. idHash is the key and never an attribute.
const PRE_ATTRS = {
  step: 'step',
  email: 'email',
  emailHash: 'email_hash',
  challengeSession: 'challenge_session',
  totpSecret: 'totp_secret',
  acceptedVersions: 'accepted_versions',
  lang: 'lang',
  attempts: 'attempts',
  expiresAt: 'expires_at',
} as const satisfies Record<Exclude<keyof PreAuthRow, 'idHash'>, string>;

function preAuthItem(fields: Partial<Omit<PreAuthRow, 'idHash'>>): Item {
  const item: Item = {};
  for (const [field, attr] of Object.entries(PRE_ATTRS) as [keyof typeof PRE_ATTRS, string][]) {
    if (!(field in fields)) continue;
    const value = fields[field];
    item[attr] = field === 'expiresAt' && num(value) ? seconds(value) : value;
  }
  return item;
}

function toPreAuthRow(item: Item): PreAuthRow | undefined {
  const { pk, step, email, email_hash, challenge_session, totp_secret, accepted_versions, lang, attempts, expires_at } = item;
  if (!str(pk) || !pk.startsWith(PRE) || !str(step) || !str(email) || !str(email_hash) || !num(attempts) || !num(expires_at)) return undefined;
  if (lang !== 'en' && lang !== 'es') return undefined;
  if (challenge_session !== undefined && !str(challenge_session)) return undefined;
  if (totp_secret !== undefined && !str(totp_secret)) return undefined;
  let acceptedVersions: PreAuthRow['acceptedVersions'];
  if (accepted_versions !== undefined) {
    const v = accepted_versions as Item | null;
    if (!v || typeof v !== 'object' || !str(v.terms) || !str(v.privacy)) return undefined;
    acceptedVersions = { terms: v.terms, privacy: v.privacy };
  }
  const row: PreAuthRow = { idHash: pk.slice(PRE.length), step, email, emailHash: email_hash, lang, attempts, expiresAt: expires_at * 1000 };
  if (challenge_session !== undefined) row.challengeSession = challenge_session;
  if (totp_secret !== undefined) row.totpSecret = totp_secret;
  if (acceptedVersions) row.acceptedVersions = acceptedVersions;
  return row;
}

export class DynamoPreAuthStore extends TableStore implements PreAuthStore {
  async create(row: PreAuthRow) {
    const { idHash, ...fields } = row;
    const item = preAuthItem(fields);
    for (const k of Object.keys(item)) if (item[k] === undefined) delete item[k];
    await this.client.send(new PutCommand({ TableName: this.table, Item: { pk: PRE + idHash, ...item } }));
  }

  async get(idHash: string) {
    const item = await this.read(PRE + idHash);
    return item && toPreAuthRow(item);
  }

  async update(idHash: string, patch: Partial<Omit<PreAuthRow, 'idHash'>>) {
    const fields = preAuthItem(patch);
    if (Object.keys(fields).length === 0) return (await this.get(idHash)) !== undefined;
    return this.patch(PRE + idHash, fields);
  }

  async delete(idHash: string) {
    await this.remove(PRE + idHash);
  }
}
