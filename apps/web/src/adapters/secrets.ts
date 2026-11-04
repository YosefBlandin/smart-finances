import { GetSecretValueCommand, SecretsManagerClient, type GetSecretValueCommandOutput } from '@aws-sdk/client-secrets-manager';
import type { Clock } from '@/ports/clock';
import type { SecretStore } from '@/ports/secret-store';

/** The one call this adapter makes; tests pass a hand-written fake. */
export type SecretsClient = { send(command: GetSecretValueCommand): Promise<GetSecretValueCommandOutput> };

const FIVE_MINUTES = 5 * 60_000;

// Secrets Manager through the compute role (D-73, D-115): the settings carry only ARNs, never a secret value. Each
// value is a plain string, cached 5 minutes; concurrent reads share one call; a failure is not cached.
export class SecretsManagerStore implements SecretStore {
  private readonly client: SecretsClient;
  private readonly clock: Clock;
  private readonly ttlMs: number;
  private readonly cache = new Map<string, { value: string; at: number }>();
  private readonly inflight = new Map<string, Promise<string>>();

  constructor({ client, region, clock, ttlMs = FIVE_MINUTES }: { client?: SecretsClient; region?: string; clock: Clock; ttlMs?: number }) {
    this.client = client ?? new SecretsManagerClient({ region });
    this.clock = clock;
    this.ttlMs = ttlMs;
  }

  async get(arn: string): Promise<string> {
    const hit = this.cache.get(arn);
    if (hit && this.clock.now() - hit.at < this.ttlMs) return hit.value;
    const pending = this.inflight.get(arn);
    if (pending) return pending;
    const read = this.read(arn).finally(() => this.inflight.delete(arn));
    this.inflight.set(arn, read);
    return read;
  }

  private async read(arn: string): Promise<string> {
    let out: GetSecretValueCommandOutput;
    try {
      out = await this.client.send(new GetSecretValueCommand({ SecretId: arn }));
    } catch (e) {
      // Only the error's name: the SDK's message is not ours to vouch for.
      throw new Error(`Secret ${arn} could not be read: ${e instanceof Error ? e.name : 'unknown error'}`);
    }
    if (typeof out.SecretString !== 'string') throw new Error(`Secret ${arn} has no string value`);
    this.cache.set(arn, { value: out.SecretString, at: this.clock.now() });
    return out.SecretString;
  }
}
