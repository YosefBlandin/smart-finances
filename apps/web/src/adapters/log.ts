import type { Clock } from '@/ports/clock';
import type { Logger } from '@/ports/logger';

// architecture.md Contracts "Security events" (D-80, RK-6): one JSON line per event, never an email, password, code,
// token, secret or IP. A field whose name holds one of these words, in any case or spelling (accessToken, client_ip,
// emailHash), makes the call throw before anything is written.
const REFUSED = new Set(['password', 'code', 'secret', 'token', 'email', 'ip']);

/** The words of a key: camelCase, snake_case, kebab-case and spaces split; lower case. */
function words(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function assertSafeFields(context: object): void {
  for (const key of Object.keys(context)) {
    if (words(key).some((w) => REFUSED.has(w))) throw new Error(`Logger refused field ${key}: security events never carry it`);
  }
}

export class JsonLogger implements Logger {
  private readonly clock: Clock;
  private readonly write: (line: string) => void;

  // stdout reaches the web server's log group, where the alarms' metric filters read $.event (AlarmsStack).
  constructor({ clock, write = (line) => console.log(line) }: { clock: Clock; write?: (line: string) => void }) {
    this.clock = clock;
    this.write = write;
  }

  event(name: string, outcome: string, context: { sub?: string; requestId: string }): void {
    assertSafeFields(context);
    const line: Record<string, string> = { event: name, outcome };
    if (context.sub !== undefined) line.sub = context.sub;
    line.request_id = context.requestId;
    line.ts = new Date(this.clock.now()).toISOString();
    // JSON.stringify escapes every newline inside a value, so one event is always one line.
    this.write(JSON.stringify(line));
  }
}
