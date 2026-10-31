// The web server settings (architecture.md Contracts "Web server settings", D-110), Zod-parsed by the adapter.
export type WebSettings = {
  STAGE: string;
  AWS_REGION: string;
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
