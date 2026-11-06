import { GetParameterCommand, SSMClient, type GetParameterCommandOutput } from '@aws-sdk/client-ssm';
import type { Clock } from '@/ports/clock';
import type { ParameterStore } from '@/ports/parameter-store';

/** The one call this adapter makes; tests pass a hand-written fake. */
export type SsmClient = { send(command: GetParameterCommand): Promise<GetParameterCommandOutput> };

/** How long a value is kept (architecture.md Contracts "Ports": a 60-second cache). */
export const PARAMETER_CACHE_MS = 60_000;

// Stage parameters through the compute role (WebStack grants ssm:GetParameter on /smart-finances/<stage>/*; D-167
// replaces the fail-closed parameter store). A value, or its absence, is kept 60 seconds, so an emergency switch such as
// imports-paused takes effect within a minute; concurrent reads share one call; a failure is not kept and is thrown, so
// a caller fails closed rather than reading a switch it could not read as "off".
export class SsmParameterStore implements ParameterStore {
  private readonly client: SsmClient;
  private readonly clock: Clock;
  private readonly ttlMs: number;
  private readonly cache = new Map<string, { value: string | undefined; at: number }>();
  private readonly inflight = new Map<string, Promise<string | undefined>>();

  constructor({ client, region, clock, ttlMs = PARAMETER_CACHE_MS }: { client?: SsmClient; region?: string; clock: Clock; ttlMs?: number }) {
    this.client = client ?? new SSMClient({ region });
    this.clock = clock;
    this.ttlMs = ttlMs;
  }

  async get(name: string): Promise<string | undefined> {
    const hit = this.cache.get(name);
    if (hit && this.clock.now() - hit.at < this.ttlMs) return hit.value;
    const pending = this.inflight.get(name);
    if (pending) return pending;
    const read = this.read(name).finally(() => this.inflight.delete(name));
    this.inflight.set(name, read);
    return read;
  }

  private async read(name: string): Promise<string | undefined> {
    let value: string | undefined;
    try {
      const out = await this.client.send(new GetParameterCommand({ Name: name }));
      value = out.Parameter?.Value;
    } catch (e) {
      if (e instanceof Error && e.name === 'ParameterNotFound') value = undefined;
      // Only the error's name: the SDK's message is not ours to vouch for.
      else throw new Error(`Parameter ${name} could not be read: ${e instanceof Error ? e.name : 'unknown error'}`);
    }
    this.cache.set(name, { value, at: this.clock.now() });
    return value;
  }
}
