import { UpdateCommand, type UpdateCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { Counter } from '@/ports/counter';
import { documentClient, type DocClient } from './sessions';

// Window counters in the sessions table (architecture.md Contracts "Sessions table", counter item; D-120). One item
// per key and window: pk RL#<scope>#<value>#<window start>, n, expires_at. The key's value is already an HMAC (D-115).
// One atomic ADD per count, so concurrent requests never lose a count; expires_at is the window start plus the ttl
// (the window end plus one minute), in epoch seconds as the table's TTL needs. A new window is a new item, so a
// lagging TTL never carries an old count over. Service errors are thrown, never read as a count of zero.

type Options = { client?: DocClient; region?: string; tableName: string };

export class DynamoCounter implements Counter {
  private readonly client: DocClient;
  private readonly table: string;

  constructor(opts: Options) {
    this.client = opts.client ?? documentClient(opts.region);
    this.table = opts.tableName;
  }

  /** ttl is in ms from windowStart. */
  async incr(key: string, windowStart: number, ttl: number): Promise<number> {
    const out = (await this.client.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { pk: `${key}#${windowStart}` },
        UpdateExpression: 'ADD #n :one SET #expires_at = :expires_at',
        ExpressionAttributeNames: { '#n': 'n', '#expires_at': 'expires_at' },
        ExpressionAttributeValues: { ':one': 1, ':expires_at': Math.ceil((windowStart + ttl) / 1000) },
        ReturnValues: 'UPDATED_NEW',
      }),
    )) as UpdateCommandOutput;
    const n = out.Attributes?.n;
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('counter update returned no count');
    return n;
  }
}
