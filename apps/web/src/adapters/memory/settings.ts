import type { Settings, WebSettings } from '@/ports/settings';

export const TEST_SETTINGS: WebSettings = {
  STAGE: 'test',
  AWS_REGION: 'us-east-1',
  API_URL: 'http://api.test.invalid',
  USER_POOL_ID: 'us-east-1_test',
  WEB_CLIENT_ID: 'test-client',
  WEB_CLIENT_SECRET_ARN: 'arn:test:web-client-secret',
  HMAC_SECRET_ARN: 'arn:test:hmac-secret',
  SESSIONS_TABLE: 'sessions-test',
  ACCOUNTS_TABLE: 'accounts-test',
  UPLOAD_HOST: 'uploads.test.invalid',
  WEB_ORIGIN: 'http://localhost:3000',
  SUPPORT_ADDRESS: 'support@example.test',
  COMMIT_SHA: 'test',
};

export class MemorySettings implements Settings {
  constructor(private readonly values: WebSettings = TEST_SETTINGS) {}
  get() {
    return this.values;
  }
}
