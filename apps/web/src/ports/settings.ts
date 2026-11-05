// The web server settings (architecture.md Contracts "Web server settings", D-110), Zod-parsed by the adapter.
// Secrets are never settings: only their ARNs are, and SecretStore reads the values at run time.
export type WebSettings = {
  STAGE: 'test' | 'qa' | 'staging' | 'prod';
  /** Not a variable: the runtime's AWS_REGION, else us-east-1 (D-159, D-89). */
  REGION: string;
  API_URL: string;
  USER_POOL_ID: string;
  WEB_CLIENT_ID: string;
  WEB_CLIENT_SECRET_ARN: string;
  HMAC_SECRET_ARN: string;
  SESSIONS_TABLE: string;
  ACCOUNTS_TABLE: string;
  UPLOAD_HOST: string;
  WEB_ORIGIN: string;
  SUPPORT_ADDRESS: string;
  COMMIT_SHA: string;
};

export interface Settings {
  get(): WebSettings;
}
