import type { Logger } from '@/ports/logger';
import { assertSafeFields } from '../log';

// Keeps events for tests; refuses the same field names as the real logger, so a leak fails under STAGE=test too.
export class MemoryLogger implements Logger {
  readonly events: { name: string; outcome: string; sub?: string; requestId: string }[] = [];
  event(name: string, outcome: string, context: { sub?: string; requestId: string }) {
    assertSafeFields(context);
    this.events.push({ name, outcome, sub: context.sub, requestId: context.requestId });
  }
}
