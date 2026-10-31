import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

// T-WEB-3 (D-71, D-110): /api/health returns { sha, stage } from the settings, never cached.
describe('T-WEB-3 GET /api/health', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('T-WEB-3 returns the commit and the stage from the settings, with no-store', async () => {
    vi.stubEnv('STAGE', 'qa');
    vi.stubEnv('COMMIT_SHA', 'abc1234');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ sha: 'abc1234', stage: 'qa' });
  });

  it('T-WEB-3 falls back to test defaults only when STAGE is test', async () => {
    vi.stubEnv('STAGE', 'test');
    vi.stubEnv('COMMIT_SHA', '');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sha: 'test', stage: 'test' });
  });

  it('T-WEB-3 says plainly that settings are missing outside test, without guessing', async () => {
    vi.stubEnv('STAGE', '');
    vi.stubEnv('COMMIT_SHA', '');
    const res = await GET();
    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ error: { code: 'not_configured', message: 'Server settings are missing.' } });
  });

  it('T-WEB-3 returns nothing but sha and stage, so no other setting can leak', async () => {
    vi.stubEnv('STAGE', 'qa');
    vi.stubEnv('COMMIT_SHA', 'abc1234');
    vi.stubEnv('HMAC_SECRET_ARN', 'arn:aws:secretsmanager:eu-central-1:000000000000:secret:x');
    const body = await (await GET()).json();
    expect(Object.keys(body).sort()).toEqual(['sha', 'stage']);
  });
});
