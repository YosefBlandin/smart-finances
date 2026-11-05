import { PutCommand } from '@aws-sdk/lib-dynamodb';
import type { Clock } from '@/ports/clock';
import type { PowStore } from '@/ports/pow-store';
import { documentClient, type DocClient } from './sessions';

// Proof-of-work answers used once (architecture.md Contracts "Sessions table", pow item; D-120): pk POW#<sha256 of
// salt>, expires_at. One conditional put claims it; the condition also lets a row past its expires_at be claimed
// again, because the TTL may lag by days (the answer itself has expired by then, so verify() refuses it first).
// expires_at is in epoch seconds, as the TTL needs, rounded up so a claim never ends early. Service errors are thrown,
// never read as a claim.

type Options = { client?: DocClient; region?: string; tableName: string; clock: Clock };

const conditionFailed = (e: unknown) => e instanceof Error && e.name === 'ConditionalCheckFailedException';

export class DynamoPowStore implements PowStore {
  private readonly client: DocClient;
  private readonly table: string;
  private readonly clock: Clock;

  constructor(opts: Options) {
    this.client = opts.client ?? documentClient(opts.region);
    this.table = opts.tableName;
    this.clock = opts.clock;
  }

  /** ttl is in ms from now. */
  async claim(saltHash: string, ttl: number): Promise<boolean> {
    const now = this.clock.now();
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.table,
          Item: { pk: `POW#${saltHash}`, expires_at: Math.ceil((now + ttl) / 1000) },
          ConditionExpression: 'attribute_not_exists(pk) OR expires_at <= :now',
          ExpressionAttributeValues: { ':now': Math.floor(now / 1000) },
        }),
      );
      return true;
    } catch (e) {
      if (conditionFailed(e)) return false;
      throw e;
    }
  }
}
