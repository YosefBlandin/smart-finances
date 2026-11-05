import { z } from 'zod';
import type { Settings, WebSettings } from '@/ports/settings';
import { TEST_SETTINGS } from './memory/settings';

// architecture.md Contracts "Web server settings" (D-110): WebStack writes these as branch variables, amplify.yml
// copies them and COMMIT_SHA into .env.production. The region is no variable (Amplify reserves AWS_): it comes from
// the runtime's AWS_REGION, else us-east-1 (D-159, D-89). Secrets are never variables, only their ARNs (D-73).
type Env = Record<string, string | undefined>;

const SECRET_ARN = /^arn:aws[a-z-]*:secretsmanager:[a-z0-9-]+:\d{12}:secret:[\w/+=.@-]+$/;
const HOST = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

const schema = z
  .object({
    STAGE: z.enum(['test', 'qa', 'staging', 'prod']),
    REGION: z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d+$/),
    API_URL: z.url(),
    USER_POOL_ID: z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d+_[0-9A-Za-z]+$/),
    WEB_CLIENT_ID: z.string().regex(/^[\w-]{1,128}$/),
    WEB_CLIENT_SECRET_ARN: z.string().regex(SECRET_ARN),
    HMAC_SECRET_ARN: z.string().regex(SECRET_ARN),
    SESSIONS_TABLE: z.string().regex(/^[\w.-]{3,255}$/),
    ACCOUNTS_TABLE: z.string().regex(/^[\w.-]{3,255}$/),
    UPLOAD_HOST: z.string().regex(HOST),
    WEB_ORIGIN: z.url(),
    SUPPORT_ADDRESS: z.email(),
    COMMIT_SHA: z.string().regex(/^[\w.-]{1,64}$/),
  })
  .superRefine((s, ctx) => {
    // The Origin check compares this string exactly (D-115), so it must be a bare origin: scheme, host, port.
    const origin = URL.canParse(s.WEB_ORIGIN) ? new URL(s.WEB_ORIGIN).origin : '';
    if (origin !== s.WEB_ORIGIN) ctx.addIssue({ code: 'custom', path: ['WEB_ORIGIN'], message: 'not a bare origin' });
    // Plain http only for the local test stage.
    if (s.STAGE !== 'test') {
      for (const key of ['WEB_ORIGIN', 'API_URL'] as const) {
        if (!s[key].startsWith('https://')) ctx.addIssue({ code: 'custom', path: [key], message: 'not https' });
      }
    }
  }) satisfies z.ZodType<WebSettings>;

const NAMES = Object.keys(schema.shape).filter((n) => n !== 'REGION') as (keyof WebSettings)[];

/**
 * Reads the settings from an environment. Under STAGE=test each missing name takes its test default. A bad or missing
 * value throws an error that names the settings only, never a value (a misplaced secret must not reach a log).
 */
export function parseSettings(env: Env): WebSettings {
  const read = (name: string) => (env[name] === '' ? undefined : env[name]);
  const defaults: Partial<WebSettings> = read('STAGE') === 'test' ? TEST_SETTINGS : {};
  const input: Record<string, string | undefined> = { REGION: read('AWS_REGION') ?? 'us-east-1' };
  for (const name of NAMES) input[name] = read(name) ?? defaults[name];
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '?')))];
    throw new Error(`Web server settings missing or invalid: ${names.join(', ')}`);
  }
  return parsed.data;
}

// Parses once, when the container is built, so a bad environment fails the first request instead of a later one.
export class EnvSettings implements Settings {
  private readonly values: WebSettings;
  constructor(env: Env = process.env) {
    this.values = Object.freeze(parseSettings(env));
  }
  get(): WebSettings {
    return this.values;
  }
}
