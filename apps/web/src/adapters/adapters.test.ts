import { GetSecretValueCommand, type GetSecretValueCommandOutput } from '@aws-sdk/client-secrets-manager';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EnvSettings, parseSettings } from './env-settings';
import { JsonLogger } from './log';
import { MemoryClock } from './memory/clock';
import { MemoryLogger } from './memory/logger';
import { TEST_SETTINGS } from './memory/settings';
import { SecretsManagerStore, type SecretsClient } from './secrets';

const MIN = 60_000;

// Synthetic values only (example.test, the all-zero account id).
const ARN = (name: string) => `arn:aws:secretsmanager:us-east-1:000000000000:secret:smart-finances/qa/${name}-AbCdEf`;
const QA_ENV = {
  STAGE: 'qa',
  API_URL: 'https://api.example.test',
  USER_POOL_ID: 'us-east-1_Example0',
  WEB_CLIENT_ID: 'exampleclientid0000000000',
  WEB_CLIENT_SECRET_ARN: ARN('web-client-secret'),
  HMAC_SECRET_ARN: ARN('hmac-secret'),
  SESSIONS_TABLE: 'smart-finances-qa-sessions',
  ACCOUNTS_TABLE: 'smart-finances-qa-accounts',
  UPLOAD_HOST: 'uploads-example.s3.us-east-1.amazonaws.com',
  WEB_ORIGIN: 'https://qa.example.test',
  SUPPORT_ADDRESS: 'support@example.test',
  COMMIT_SHA: '0123456789abcdef0123456789abcdef01234567',
};
// Contracts "Web server settings": the names WebStack writes, plus COMMIT_SHA from amplify.yml.
const CONTRACT_NAMES = [
  'STAGE',
  'API_URL',
  'USER_POOL_ID',
  'WEB_CLIENT_ID',
  'WEB_CLIENT_SECRET_ARN',
  'HMAC_SECRET_ARN',
  'SESSIONS_TABLE',
  'ACCOUNTS_TABLE',
  'UPLOAD_HOST',
  'WEB_ORIGIN',
  'SUPPORT_ADDRESS',
  'COMMIT_SHA',
];

function errorOf(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected a throw');
}

describe('T-WAUTH-1: settings load from the named variables', () => {
  it('T-WAUTH-1: every Contracts name is read from its variable, and the region comes from the runtime', () => {
    const s = parseSettings({ ...QA_ENV, AWS_REGION: 'us-west-2' });
    expect(s).toEqual({ ...QA_ENV, REGION: 'us-west-2' });
    expect(Object.keys(s).sort()).toEqual([...CONTRACT_NAMES, 'REGION'].sort());
  });

  it('T-WAUTH-1: with no region from the runtime the region is us-east-1 (D-159, D-89)', () => {
    expect(parseSettings(QA_ENV).REGION).toBe('us-east-1');
    expect(parseSettings({ ...QA_ENV, AWS_REGION: '' }).REGION).toBe('us-east-1');
  });

  it('T-WAUTH-1: STAGE=test fills every missing name with the test defaults, and a set variable still wins', () => {
    expect(parseSettings({ STAGE: 'test' })).toEqual(TEST_SETTINGS);
    expect(parseSettings({ STAGE: 'test', WEB_ORIGIN: 'http://localhost:3100' }).WEB_ORIGIN).toBe('http://localhost:3100');
  });

  it('T-WAUTH-1: outside STAGE=test a missing or empty name is refused, naming the setting', () => {
    for (const name of CONTRACT_NAMES.filter((n) => n !== 'STAGE')) {
      const env: Record<string, string> = { ...QA_ENV };
      delete env[name];
      expect(() => parseSettings(env), name).toThrow(new RegExp(`\\b${name}\\b`));
      expect(() => parseSettings({ ...QA_ENV, [name]: '' }), name).toThrow(new RegExp(`\\b${name}\\b`));
    }
    expect(() => parseSettings({})).toThrow(/STAGE/);
    expect(() => parseSettings({ ...QA_ENV, STAGE: 'nightly' })).toThrow(/STAGE/);
  });

  it('T-WAUTH-1: values are checked: an https origin with no path, a URL, an email, a host name', () => {
    const bad: Record<string, string[]> = {
      WEB_ORIGIN: ['http://qa.example.test', 'https://qa.example.test/', 'https://qa.example.test/path', 'qa.example.test'],
      API_URL: ['not a url', 'http://api.example.test'],
      SUPPORT_ADDRESS: ['support'],
      UPLOAD_HOST: ['https://uploads.example.test', 'uploads.example.test/x'],
      USER_POOL_ID: ['pool'],
    };
    for (const [name, values] of Object.entries(bad)) {
      for (const v of values) expect(() => parseSettings({ ...QA_ENV, [name]: v }), `${name}=${v}`).toThrow(new RegExp(name));
    }
  });

  it('T-WAUTH-1: a secret value is never a variable: an ARN setting holding anything but a Secrets Manager ARN is refused without echoing it', () => {
    const leaked = 'Sup3r-s3cret-value-that-must-not-print';
    for (const name of ['WEB_CLIENT_SECRET_ARN', 'HMAC_SECRET_ARN']) {
      const err = errorOf(() => parseSettings({ ...QA_ENV, [name]: leaked }));
      expect(err.message).toMatch(new RegExp(name));
      expect(err.message).not.toContain(leaked);
      expect(JSON.stringify(err)).not.toContain(leaked);
    }
    expect(() => parseSettings({ ...QA_ENV, HMAC_SECRET_ARN: 'arn:aws:ssm:us-east-1:000000000000:parameter/x' })).toThrow(/HMAC_SECRET_ARN/);
  });

  it('T-WAUTH-1: variables outside the contract never reach the settings, whatever their name', () => {
    const s = parseSettings({ ...QA_ENV, WEB_CLIENT_SECRET: 'raw-secret', HMAC_SECRET: 'raw-hmac', AWS_SECRET_ACCESS_KEY: 'runtime-key' });
    expect(Object.keys(s).sort()).toEqual([...CONTRACT_NAMES, 'REGION'].sort());
    expect(JSON.stringify(s)).not.toMatch(/raw-secret|raw-hmac|runtime-key/);
  });

  it('T-WAUTH-1: EnvSettings parses once when built and fails fast on a bad environment', () => {
    const env: Record<string, string | undefined> = { ...QA_ENV };
    const settings = new EnvSettings(env);
    env.WEB_ORIGIN = 'https://changed.example.test';
    expect(settings.get().WEB_ORIGIN).toBe('https://qa.example.test');
    expect(Object.isFrozen(settings.get())).toBe(true);
    expect(() => new EnvSettings({ STAGE: 'qa' })).toThrow(/API_URL/);
  });

  it('T-WAUTH-1: amplify.yml writes every contract name and the commit id into .env.production, and no AWS_REGION (D-159)', () => {
    const yml = readFileSync(new URL('../../amplify.yml', import.meta.url), 'utf8');
    const grep = yml.split('\n').find((l) => l.includes('> .env.production'));
    expect(grep).toBeDefined();
    const names = /\^\((.*?)\)=/.exec(grep!)?.[1]?.split('|') ?? [];
    expect(names.sort()).toEqual(CONTRACT_NAMES.filter((n) => n !== 'COMMIT_SHA').sort());
    expect(yml).toMatch(/echo "COMMIT_SHA=\$AWS_COMMIT_ID" >> \.env\.production/);
    expect(yml).not.toMatch(/AWS_REGION/);
  });
});

// A hand-written Secrets Manager client: records each call and answers from a map.
class FakeSecretsClient implements SecretsClient {
  readonly calls: string[] = [];
  fail: Error | undefined;
  constructor(
    private readonly values: Record<string, GetSecretValueCommandOutput>,
    private readonly gate?: Promise<void>,
  ) {}
  async send(command: GetSecretValueCommand) {
    expect(command).toBeInstanceOf(GetSecretValueCommand);
    const id = command.input.SecretId ?? '';
    this.calls.push(id);
    await this.gate;
    if (this.fail) throw this.fail;
    const v = this.values[id];
    if (!v) throw Object.assign(new Error('Secrets Manager cannot find the specified secret.'), { name: 'ResourceNotFoundException' });
    return v;
  }
}
const out = (o: Partial<GetSecretValueCommandOutput>) => ({ $metadata: {}, ...o }) as GetSecretValueCommandOutput;

describe('T-WAUTH-1: secrets come from Secrets Manager, never a variable', () => {
  const arn = ARN('hmac-secret');

  it('T-WAUTH-1: get(arn) asks Secrets Manager for that ARN and returns the plain string', async () => {
    const client = new FakeSecretsClient({ [arn]: out({ SecretString: 'plain-hmac-value' }) });
    const store = new SecretsManagerStore({ client, clock: new MemoryClock(0) });
    expect(await store.get(arn)).toBe('plain-hmac-value');
    expect(client.calls).toEqual([arn]);
  });

  it('T-WAUTH-1: a JSON-looking secret is returned as the plain string, not parsed', async () => {
    const client = new FakeSecretsClient({ [arn]: out({ SecretString: '{"k":"v"}' }) });
    expect(await new SecretsManagerStore({ client, clock: new MemoryClock(0) }).get(arn)).toBe('{"k":"v"}');
  });

  it('T-WAUTH-1: the value is cached for 5 minutes, then read again', async () => {
    const clock = new MemoryClock(0);
    const client = new FakeSecretsClient({ [arn]: out({ SecretString: 'v1' }) });
    const store = new SecretsManagerStore({ client, clock });
    await store.get(arn);
    clock.advance(5 * MIN - 1);
    expect(await store.get(arn)).toBe('v1');
    expect(client.calls).toHaveLength(1);
    clock.advance(1);
    await store.get(arn);
    expect(client.calls).toHaveLength(2);
  });

  it('T-WAUTH-1: concurrent reads of one ARN share one call', async () => {
    let open!: () => void;
    const client = new FakeSecretsClient({ [arn]: out({ SecretString: 'v' }) }, new Promise<void>((r) => (open = r)));
    const store = new SecretsManagerStore({ client, clock: new MemoryClock(0) });
    const both = Promise.all([store.get(arn), store.get(arn)]);
    open();
    expect(await both).toEqual(['v', 'v']);
    expect(client.calls).toHaveLength(1);
  });

  it('T-WAUTH-1: a failed read is not cached, and its error carries no secret value', async () => {
    const clock = new MemoryClock(0);
    const client = new FakeSecretsClient({ [arn]: out({ SecretString: 'after-the-outage' }) });
    client.fail = Object.assign(new Error('throttled'), { name: 'ThrottlingException' });
    const store = new SecretsManagerStore({ client, clock });
    await expect(store.get(arn)).rejects.toThrow(/ThrottlingException/);
    client.fail = undefined;
    expect(await store.get(arn)).toBe('after-the-outage');
    expect(client.calls).toHaveLength(2);
  });

  it('T-WAUTH-1: a missing secret or one with no string value is an error', async () => {
    const client = new FakeSecretsClient({ [arn]: out({ SecretBinary: new Uint8Array([1]) }) });
    const store = new SecretsManagerStore({ client, clock: new MemoryClock(0) });
    await expect(store.get(arn)).rejects.toThrow(/no string value/);
    await expect(store.get(ARN('missing'))).rejects.toThrow(/ResourceNotFoundException/);
  });

  it('T-WAUTH-1: the test defaults point the ARN settings at secrets the memory store holds', async () => {
    const { MemorySecretStore } = await import('./memory/secret-store');
    const store = new MemorySecretStore();
    expect(await store.get(TEST_SETTINGS.WEB_CLIENT_SECRET_ARN)).toBeTruthy();
    expect(await store.get(TEST_SETTINGS.HMAC_SECRET_ARN)).toBeTruthy();
  });
});

describe('T-WAUTH-2: the logger writes one JSON security event per line and refuses secret fields', () => {
  const make = () => {
    const lines: string[] = [];
    const logger = new JsonLogger({ clock: new MemoryClock(Date.UTC(2026, 10, 4, 12, 0, 0)), write: (l) => lines.push(l) });
    return { lines, logger };
  };

  it('T-WAUTH-2: one call writes exactly one JSON line with event, outcome, sub, request_id and ts', () => {
    const { lines, logger } = make();
    logger.event('signin', 'ok', { sub: '00000000-0000-4000-8000-000000000001', requestId: 'req-1' });
    logger.event('signin_fail', 'bad_credentials', { requestId: 'req-2' });
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l).not.toContain('\n');
    expect(JSON.parse(lines[0]!)).toEqual({
      event: 'signin',
      outcome: 'ok',
      sub: '00000000-0000-4000-8000-000000000001',
      request_id: 'req-1',
      ts: '2026-11-04T12:00:00.000Z',
    });
    expect(JSON.parse(lines[1]!)).toEqual({ event: 'signin_fail', outcome: 'bad_credentials', request_id: 'req-2', ts: '2026-11-04T12:00:00.000Z' });
  });

  it('T-WAUTH-2: it throws on a key named password, code, secret, token, email or ip, and writes nothing', () => {
    const forbidden = ['password', 'code', 'secret', 'token', 'email', 'ip'];
    const variants = [
      'Password',
      'EMAIL',
      'accessToken',
      'refresh_token',
      'clientIp',
      'client-ip',
      'newPassword',
      'emailHash',
      'mfaCode',
      'clientSecret',
    ];
    const { lines, logger } = make();
    for (const key of [...forbidden, ...variants]) {
      const context = { requestId: 'r', [key]: 'x' } as unknown as { requestId: string };
      expect(() => logger.event('signin', 'ok', context), key).toThrow(new RegExp(`refused field ${key}`, 'i'));
    }
    expect(lines).toEqual([]);
  });

  it('T-WAUTH-2: it allows sub and requestId, and words that only contain the letters (zip, codec, description)', () => {
    const { lines, logger } = make();
    const context = { requestId: 'r', sub: 's', zip: '1', codec: 'x', description: 'y' } as unknown as { requestId: string };
    expect(() => logger.event('health', 'ok', context)).not.toThrow();
    expect(lines).toHaveLength(1);
  });

  it('T-WAUTH-2: the memory logger used under STAGE=test refuses the same keys', () => {
    const logger = new MemoryLogger();
    for (const key of ['password', 'code', 'secret', 'token', 'email', 'ip']) {
      expect(() => logger.event('signin', 'ok', { requestId: 'r', [key]: 'x' } as unknown as { requestId: string }), key).toThrow(/refused field/);
    }
    expect(logger.events).toEqual([]);
  });
});
