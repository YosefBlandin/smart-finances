// @vitest-environment jsdom
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryParameterStore } from '@/adapters/memory/parameter-store';
import type { ParameterStore } from '@/ports/parameter-store';

// T-WSCR-20 (D-135, D-162): browser monitoring with CloudWatch RUM. The web server reads the rum-* stage parameters
// through ParameterStore and hands them to the client component in the root layout; the client starts aws-rum-web with
// no cookies and nothing in browser storage (its guest credentials stay in memory), page ids as the path alone (no
// search values), page loads, web vitals and JavaScript errors only (no HTTP telemetry, no resource URLs), and no
// person id. Under STAGE=test it stays off. Synthetic ids only.

const app = vi.hoisted(() => ({
  stage: 'qa' as string,
  store: undefined as unknown as ParameterStore,
}));
vi.mock('./fonts', () => ({ fontVariables: 'fonts' }));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-nonce': 'n' }) }));
vi.mock('@/adapters/container', () => ({
  getContainer: () => ({
    settings: { get: () => ({ STAGE: app.stage, REGION: 'us-east-1', COMMIT_SHA: 'abc1234' }) },
    parameterStore: app.store,
  }),
}));

const IDS = {
  appMonitorId: '00000000-0000-4000-8000-00000000a0a0',
  identityPoolId: 'us-east-1:00000000-0000-4000-8000-00000000b0b0',
  guestRoleArn: 'arn:aws:iam::000000000000:role/synthetic-rum-guest',
};
const SETTINGS = { ...IDS, region: 'us-east-1', version: 'abc1234' };

function parameters(stage: string, values: Partial<typeof IDS> = IDS): MemoryParameterStore {
  const store = new MemoryParameterStore();
  if (values.appMonitorId) store.set(`/smart-finances/${stage}/rum-app-monitor-id`, values.appMonitorId);
  if (values.identityPoolId) store.set(`/smart-finances/${stage}/rum-identity-pool-id`, values.identityPoolId);
  if (values.guestRoleArn) store.set(`/smart-finances/${stage}/rum-guest-role-arn`, values.guestRoleArn);
  return store;
}

/** The Rum element the root layout renders, found in its element tree. */
async function rumInLayout(): Promise<ReactElement<{ settings: unknown }> | undefined> {
  const { default: RootLayout } = await import('./layout');
  const { Rum } = await import('./rum');
  const tree = await RootLayout({ children: null });
  const walk = (node: ReactNode): ReactElement<{ settings: unknown }> | undefined => {
    if (Array.isArray(node)) return node.map(walk).find(Boolean);
    if (!isValidElement(node)) return undefined;
    if (node.type === Rum) return node as ReactElement<{ settings: unknown }>;
    return walk((node.props as { children?: ReactNode }).children);
  };
  return walk(tree);
}

beforeEach(() => {
  app.stage = 'qa';
  app.store = parameters('qa');
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('T-WSCR-20: the server reads the RUM ids through ParameterStore (D-162)', () => {
  it('T-WSCR-20: the root layout mounts Rum with the three rum-* stage parameters, the region and the commit', async () => {
    const rum = await rumInLayout();
    expect(rum?.props.settings).toEqual(SETTINGS);
  });

  it('T-WSCR-20: under STAGE=test RUM is off and no parameter is read', async () => {
    app.stage = 'test';
    const get = vi.spyOn(app.store, 'get');
    const rum = await rumInLayout();
    expect(rum === undefined || rum.props.settings === null).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });

  it('T-WSCR-20: a missing parameter, or a store that fails, leaves RUM off and the page rendering', async () => {
    app.store = parameters('qa', { appMonitorId: IDS.appMonitorId, identityPoolId: IDS.identityPoolId });
    expect((await rumInLayout())?.props.settings ?? null).toBeNull();
    app.store = { get: async () => Promise.reject(new Error('unreadable')) };
    expect((await rumInLayout())?.props.settings ?? null).toBeNull();
  });
});

describe('T-WSCR-20: the client starts RUM with no cookies, no storage, no search values and no person id (D-135)', () => {
  it('T-WSCR-20: the options: no cookies, page ids by path, errors and performance only, no resource URLs, no person', async () => {
    const { rumOptions } = await import('./rum');
    const options = rumOptions(SETTINGS);
    expect(options).toMatchObject({
      allowCookies: false,
      pageIdFormat: 'PATH',
      telemetries: ['errors', 'performance'],
      recordResourceUrl: false,
      enableXRay: false,
      endpoint: 'https://dataplane.rum.us-east-1.amazonaws.com',
    });
    // The client is given no identity pool or role: it would keep its Cognito identity and credentials in localStorage
    // (and a role makes it use the classic flow through STS, which the pool and the content policy do not allow).
    expect(options).not.toHaveProperty('identityPoolId');
    expect(options).not.toHaveProperty('guestRoleArn');
    expect(options).not.toHaveProperty('userId');
    expect(options).not.toHaveProperty('sessionAttributes');
    expect(JSON.stringify(options)).not.toMatch(/http"|interaction|replay/);
  });

  it('T-WSCR-20: guest credentials come from the identity pool (GetId, then GetCredentialsForIdentity) and stay in memory', async () => {
    const { guestCredentials } = await import('./rum');
    const calls: { url: string; target: string | null; body: unknown }[] = [];
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      const target = new Headers(init.headers).get('x-amz-target');
      calls.push({ url, target, body: JSON.parse(String(init.body)) });
      if (target?.endsWith('GetId')) return Response.json({ IdentityId: 'us-east-1:synthetic-identity' });
      return Response.json({
        IdentityId: 'us-east-1:synthetic-identity',
        Credentials: { AccessKeyId: 'ASIASYNTHETIC', SecretKey: 'synthetic', SessionToken: 'synthetic', Expiration: 4_102_444_800 },
      });
    });
    const provider = guestCredentials('us-east-1', IDS.identityPoolId, fetchFn as unknown as typeof fetch);
    const first = await provider();
    expect(first).toMatchObject({ accessKeyId: 'ASIASYNTHETIC', expiration: new Date(4_102_444_800_000) });
    await provider();
    expect(calls).toEqual([
      {
        url: 'https://cognito-identity.us-east-1.amazonaws.com/',
        target: 'AWSCognitoIdentityService.GetId',
        body: { IdentityPoolId: IDS.identityPoolId },
      },
      {
        url: 'https://cognito-identity.us-east-1.amazonaws.com/',
        target: 'AWSCognitoIdentityService.GetCredentialsForIdentity',
        body: { IdentityId: 'us-east-1:synthetic-identity' },
      },
    ]);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('T-WSCR-20: a started client writes no cookie and nothing to storage, and its page id has no search values', async () => {
    window.history.replaceState(null, '', '/transactions?month=2026-08&kind=expense');
    const sent: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.startsWith('https://cognito-identity.')) {
          const target = new Headers(init?.headers).get('x-amz-target') ?? '';
          if (target.endsWith('GetId')) return Response.json({ IdentityId: 'us-east-1:synthetic-identity' });
          return Response.json({
            Credentials: { AccessKeyId: 'ASIASYNTHETIC', SecretKey: 'synthetic', SessionToken: 'synthetic', Expiration: 4_102_444_800 },
          });
        }
        sent.push(input instanceof Request ? await input.text() : String(init?.body ?? ''));
        return new Response('{}', { status: 200 });
      }),
    );
    const { startRum } = await import('./rum');
    const rum = await startRum(SETTINGS);
    expect(rum).toBeDefined();
    rum!.dispatch();
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
    const batch = sent.join('\n');
    expect(batch).toContain('page_view_event');
    expect(batch).toContain('\\"pageId\\":\\"/transactions\\"');
    expect(batch).not.toMatch(/month|kind=|expense/);
    expect(document.cookie).toBe('');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    rum!.disable();
  });
});
