// One security event per call (architecture.md Contracts "Security events"); never a password, code, token or email.
export interface Logger {
  event(name: string, outcome: string, context: { sub?: string; requestId: string }): void;
}
