import type { SecretStore } from '@/ports/secret-store';
import { TEST_SETTINGS } from './settings';

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>([
    [TEST_SETTINGS.WEB_CLIENT_SECRET_ARN, 'test-client-secret'],
    [TEST_SETTINGS.HMAC_SECRET_ARN, 'test-hmac-secret'],
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
