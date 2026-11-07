#!/usr/bin/env node
// CI release step (D-93, D-113, RK-2, RK-3): after the stacks deploy, start the Amplify RELEASE job for this commit,
// wait for it (at most 15 minutes; FAILED or CANCELLED fails), wait until the branch's /api/health reports the commit
// and stage, then compare the response headers with architecture.md Contracts "Response headers".
//
//   node scripts/amplify-release.mjs --stage qa --branch qa --sha "$GITHUB_SHA"
//
// The app id comes from the /smart-finances/<stage>/amplify-app-id parameter. Everything runs in us-east-1 (D-89).
// release() takes its clients, fetch and clock as arguments so the tests run with fakes and no AWS call.
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { AmplifyClient, GetJobCommand, StartJobCommand } from '@aws-sdk/client-amplify';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

export const REGION = 'us-east-1';
export const JOB_TIMEOUT_MS = 15 * 60_000;
export const JOB_POLL_MS = 20_000;
export const HEALTH_TIMEOUT_MS = 5 * 60_000;
export const HEALTH_POLL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;

const DONE = 'SUCCEED';
const FAILED = new Set(['FAILED', 'CANCELLING', 'CANCELLED']);

const NAME = /^[a-z0-9-]+$/;
const BRANCH = /^[A-Za-z0-9._-]+$/;
const SHA = /^[0-9a-f]{40}$/;

/** --stage, --branch and --sha, as "--name value" or "--name=value". */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(stage|branch|sha)(?:=(.*))?$/.exec(argv[i]);
    if (!m) throw new Error(`unknown argument ${argv[i]}`);
    out[m[1]] = m[2] ?? argv[++i];
  }
  if (!out.stage || !NAME.test(out.stage)) throw new Error('--stage is required (lower-case letters, digits, dashes)');
  if (!out.branch || !BRANCH.test(out.branch)) throw new Error('--branch is required');
  if (!out.sha || !SHA.test(out.sha)) throw new Error('--sha is required (the full 40-character commit id)');
  return { stage: out.stage, branch: out.branch, sha: out.sha };
}

// Contracts "Response headers". The nonce and the upload bucket host vary, so the policy is matched with both as
// patterns; the two nonces must agree. A second policy header would arrive joined with ", " and not match.
const CSP = new RegExp(
  '^' +
    [
      "default-src 'self'",
      "script-src 'self' 'nonce-(?<script>[A-Za-z0-9+/=_-]+)' 'strict-dynamic'",
      "style-src 'self' 'nonce-(?<style>[A-Za-z0-9+/=_-]+)'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self' https://[A-Za-z0-9.-]+ https://dataplane\\.rum\\.us-east-1\\.amazonaws\\.com https://cognito-identity\\.us-east-1\\.amazonaws\\.com",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ') +
    '$',
);

const EXACT = [
  ['Strict-Transport-Security', 'max-age=31536000'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'same-origin'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
];

/** The differences between a response's headers and the contract; empty when they match. */
export function checkHeaders(headers) {
  const problems = [];
  const csp = headers.get('content-security-policy');
  const m = csp === null ? null : CSP.exec(csp);
  if (!m) problems.push(`Content-Security-Policy is ${JSON.stringify(csp)}, not the contract's policy`);
  else if (m.groups.script !== m.groups.style) problems.push('Content-Security-Policy: script-src and style-src carry different nonces');
  for (const [name, want] of EXACT) {
    const got = headers.get(name);
    if (got !== want) problems.push(`${name} is ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
  return problems;
}

async function appIdFor(ssm, stage) {
  const out = await ssm.send(new GetParameterCommand({ Name: `/smart-finances/${stage}/amplify-app-id` }));
  const id = out.Parameter?.Value;
  if (!id || !/^[a-z0-9]+$/.test(id)) throw new Error(`/smart-finances/${stage}/amplify-app-id is missing or not an app id`);
  return id;
}

async function waitForJob({ amplify, appId, branch, jobId }, { now, sleep, log }) {
  const deadline = now() + JOB_TIMEOUT_MS;
  let last = '';
  for (;;) {
    const out = await amplify.send(new GetJobCommand({ appId, branchName: branch, jobId }));
    const status = out.job?.summary?.status ?? 'UNKNOWN';
    if (status !== last) log(`job ${jobId}: ${status}`);
    last = status;
    if (status === DONE) return;
    if (FAILED.has(status)) throw new Error(`Amplify job ${jobId} ended ${status}`);
    if (now() >= deadline) throw new Error(`Amplify job ${jobId} still ${status} after 15 minutes`);
    await sleep(JOB_POLL_MS);
  }
}

function withTimeout(init = {}) {
  return { ...init, redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
}

async function waitForHealth({ fetch, origin, stage, sha }, { now, sleep, log }) {
  const deadline = now() + HEALTH_TIMEOUT_MS;
  let seen = 'no answer';
  for (;;) {
    let answer;
    try {
      const res = await fetch(`${origin}/api/health`, withTimeout({ headers: { 'cache-control': 'no-cache' } }));
      answer = res.ok ? { res, body: await res.json() } : undefined;
      seen = res.ok ? `health reports ${answer.body.sha}` : `health answered ${res.status}`;
    } catch (error) {
      seen = `health request failed (${error.name})`;
    }
    if (answer?.body.sha === sha) {
      if (answer.body.stage !== stage) throw new Error(`health reports stage ${JSON.stringify(answer.body.stage)}, want ${stage}`);
      log(`health reports ${sha} on ${stage}`);
      return answer.res;
    }
    if (now() >= deadline) throw new Error(`${seen} after ${HEALTH_TIMEOUT_MS / 60_000} minutes, want ${sha}`);
    await sleep(HEALTH_POLL_MS);
  }
}

/**
 * Start the RELEASE job for the commit, wait for it and for /api/health, and check the headers.
 * Throws with the reason on any failure.
 */
export async function release({ stage, branch, sha }, { amplify, ssm, fetch, now = Date.now, sleep = delay, log = console.log }) {
  const clock = { now, sleep, log };
  const appId = await appIdFor(ssm, stage);
  const origin = `https://${branch}.${appId}.amplifyapp.com`;

  const started = await amplify.send(new StartJobCommand({ appId, branchName: branch, jobType: 'RELEASE', commitId: sha }));
  const jobId = started.jobSummary?.jobId;
  if (!jobId) throw new Error('Amplify returned no job id');
  log(`started Amplify job ${jobId} for ${sha} on ${branch}`);
  await waitForJob({ amplify, appId, branch, jobId }, clock);

  const health = await waitForHealth({ fetch, origin, stage, sha }, clock);
  const problems = [];
  if (!/(^|,\s*)no-store(\s*,|$)/.test(health.headers.get('cache-control') ?? '')) {
    problems.push(`/api/health: Cache-Control is ${JSON.stringify(health.headers.get('cache-control'))}, want no-store`);
  }
  problems.push(...checkHeaders(health.headers).map((p) => `/api/health: ${p}`));
  const page = await fetch(`${origin}/sign-in`, withTimeout());
  problems.push(...checkHeaders(page.headers).map((p) => `/sign-in: ${p}`));
  if (problems.length) throw new Error(`response headers differ from the contract:\n- ${problems.join('\n- ')}`);
  log('response headers match the contract');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await release(args, {
    amplify: new AmplifyClient({ region: REGION }),
    ssm: new SSMClient({ region: REGION }),
    fetch: globalThis.fetch,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`amplify-release: ${error.message}`);
    process.exit(1);
  });
}
