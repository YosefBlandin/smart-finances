import type { SecretStore } from '@/ports/secret-store';

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>([
    ['arn:test:web-client-secret', 'test-client-secret'],
    ['arn:test:hmac-secret', 'test-hmac-secret'],
  ]);
  set(arn: string, value: string) {
    this.values.set(arn, value);
  }
  async get(arn: string) {
    const v = this.values.get(arn);
    if (v === undefined) throw new Error(`no secret ${arn}`);
    return v;
  }
}
