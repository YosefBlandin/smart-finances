'use client';

import type { AwsRum, AwsRumConfig } from 'aws-rum-web';
import { useEffect } from 'react';

// Browser monitoring with CloudWatch RUM (SF-172; D-135, D-162): page loads, web vitals and JavaScript errors, with the
// aws-rum-web client from npm. The root layout reads the ids from the rum-* stage parameters on the server and passes
// them here; under STAGE=test, or without them, it passes null and nothing starts.
// - No cookies (allowCookies false), and nothing in browser storage (Contracts "Cookies"): the client is given no
//   identity pool, because it would keep its Cognito identity and credentials in localStorage; guestCredentials gets
//   them from the pool's enhanced flow (cognito-identity only, the host the content policy allows) and keeps them in
//   memory. The guest role is the pool's own unauthenticated role, so guestRoleArn is carried but not sent: giving it to
//   the client would switch it to the classic flow through STS, which the pool refuses (allowClassicFlow false).
// - Page ids are the path alone (PATH): no search values. Without cookies the client records no referrer either.
// - Telemetry: errors and performance only. No HTTP telemetry, and resource events carry no URL (recordResourceUrl
//   false), so the data routes' search values (free text included) never leave the browser.
// - No person id: no userId, no session attributes.

export type RumSettings = {
  appMonitorId: string;
  identityPoolId: string;
  guestRoleArn: string;
  region: string;
  version: string;
};

/** The client's options (what AwsRum is started with). */
export function rumOptions({ region }: RumSettings): AwsRumConfig {
  return {
    allowCookies: false,
    pageIdFormat: 'PATH',
    telemetries: ['errors', 'performance'],
    recordResourceUrl: false,
    enableXRay: false,
    sessionSampleRate: 1,
    endpoint: `https://dataplane.rum.${region}.amazonaws.com`,
  };
}

type Credentials = { accessKeyId: string; secretAccessKey: string; sessionToken: string; expiration: Date };
const RENEW_BEFORE_MS = 5 * 60_000;

/**
 * Guest credentials from the identity pool's enhanced flow: GetId, then GetCredentialsForIdentity, unsigned JSON posts
 * to cognito-identity. Kept in memory until five minutes before they expire; never written to browser storage.
 */
export function guestCredentials(region: string, identityPoolId: string, fetchFn: typeof fetch = (...a) => fetch(...a)): () => Promise<Credentials> {
  const url = `https://cognito-identity.${region}.amazonaws.com/`;
  const call = async (target: string, body: object) => {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `AWSCognitoIdentityService.${target}` },
      body: JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`RUM credentials: ${target} ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  };
  let identityId: string | undefined;
  let current: Credentials | undefined;
  return async () => {
    if (current && current.expiration.getTime() - Date.now() > RENEW_BEFORE_MS) return current;
    identityId ??= String((await call('GetId', { IdentityPoolId: identityPoolId })).IdentityId);
    const c = (await call('GetCredentialsForIdentity', { IdentityId: identityId })).Credentials as Record<string, unknown>;
    current = {
      accessKeyId: String(c.AccessKeyId),
      secretAccessKey: String(c.SecretKey),
      sessionToken: String(c.SessionToken),
      expiration: new Date(Number(c.Expiration) * 1000),
    };
    return current;
  };
}

let started: Promise<AwsRum | undefined> | undefined;

/** Starts the client once per page (the root layout stays mounted); a failure leaves monitoring off. */
export function startRum(settings: RumSettings): Promise<AwsRum | undefined> {
  started ??= (async () => {
    try {
      const { AwsRum } = await import('aws-rum-web');
      const rum = new AwsRum(settings.appMonitorId, settings.version, settings.region, rumOptions(settings));
      rum.setAwsCredentials(guestCredentials(settings.region, settings.identityPoolId));
      return rum;
    } catch {
      return undefined;
    }
  })();
  return started;
}

export function Rum({ settings }: { settings: RumSettings | null }) {
  useEffect(() => {
    if (settings) void startRum(settings);
  }, [settings]);
  return null;
}
