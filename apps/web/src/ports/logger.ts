// One security event per call (architecture.md Contracts "Security events", D-80): one JSON line with event, outcome,
// sub?, request_id and ts. Adapters throw on any field named password, code, secret, token, email or ip (RK-6).
export interface Logger {
  event(name: string, outcome: string, context: { sub?: string; requestId: string }): void;
}
