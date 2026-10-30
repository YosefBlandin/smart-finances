import type { Logger } from '@/ports/logger';

export class MemoryLogger implements Logger {
  readonly events: { name: string; outcome: string; sub?: string; requestId: string }[] = [];
  event(name: string, outcome: string, context: { sub?: string; requestId: string }) {
    this.events.push({ name, outcome, sub: context.sub, requestId: context.requestId });
  }
}
