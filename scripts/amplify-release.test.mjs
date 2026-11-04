// T-WINF-14: the CI release step (D-93, D-113, RK-2, RK-3). Runs with fake Amplify, SSM and fetch and a fake clock;
// no AWS call and no network request is made.
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { GetJobCommand, StartJobCommand } from '@aws-sdk/client-amplify';
import { GetParameterCommand } from '@aws-sdk/client-ssm';
import { checkHeaders, parseArgs, release } from './amplify-release.mjs';

const APP = 'dexampleapp00';
const SHA = '0123456789abcdef0123456789abcdef01234567';
const OLD_SHA = 'fedcba9876543210fedcba9876543210fedcba98';
const ORIGIN = `https://qa.${APP}.amplifyapp.com`;
const NONCE = 'bm9uY2Utbm9uY2Utbm9uY2U=';

const policy = (nonce = NONCE, upload = 'smart-finances-qa-uploads-example.s3.us-east-1.amazonaws.com') =>
  [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' https://${upload} https://dataplane.rum.us-east-1.amazonaws.com https://cognito-identity.us-east-1.amazonaws.com`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');

const contractHeaders = (extra = {}) => ({
  'content-security-policy': policy(),
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  ...extra,
});

/** A clock that only moves when the code under test sleeps. */
function fakeClock() {
  let t = Date.parse('2026-11-04T12:00:00Z');
  return { now: () => t, sleep: async (ms) => void (t += ms), elapsed: () => t - Date.parse('2026-11-04T12:00:00Z') };
}

function fakeSsm(...args) {
  const value = args.length ? args[0] : APP; // an explicit undefined means the parameter has no value
  const calls = [];
  return {
    calls,
    async send(command) {
      calls.push(command);
      assert.ok(command instanceof GetParameterCommand, `unexpected ${command.constructor.name}`);
      return { Parameter: { Name: command.input.Name, Value: value } };
    },
  };
}

/** Amplify answers GetJob with the statuses given, then repeats the last one. */
function fakeAmplify(statuses) {
  const calls = [];
  let i = 0;
  return {
    calls,
    async send(command) {
      calls.push(command);
      if (command instanceof StartJobCommand) return { jobSummary: { jobId: '7', status: 'PENDING' } };
      if (command instanceof GetJobCommand) {
        const status = statuses[Math.min(i++, statuses.length - 1)];
        return { job: { summary: { jobId: command.input.jobId, status, commitId: SHA } } };
      }
      throw new Error(`unexpected ${command.constructor.name}`);
    },
  };
}

/** fetch answers /api/health with the shas given (then the last one), and pages with the headers given. */
function fakeFetch({ shas = [SHA], stage = 'qa', headers = contractHeaders() } = {}) {
  const calls = [];
  let i = 0;
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    const path = new URL(url).pathname;
    if (path === '/api/health') {
      const sha = shas[Math.min(i++, shas.length - 1)];
      if (sha instanceof Error) throw sha;
      return new Response(JSON.stringify({ sha, stage }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
      });
    }
    return new Response('<!doctype html><title>page</title>', { status: 200, headers: { 'content-type': 'text/html', ...headers } });
  };
  fn.calls = calls;
  return fn;
}

const run = (deps, args = {}) =>
  release({ stage: 'qa', branch: 'qa', sha: SHA, ...args }, { log: () => {}, ...deps });

test('T-WINF-14: a successful job whose health reports the sha and contract headers passes', async () => {
  const clock = fakeClock();
  const ssm = fakeSsm();
  const amplify = fakeAmplify(['PENDING', 'RUNNING', 'SUCCEED']);
  const fetch = fakeFetch({ shas: [OLD_SHA, SHA] });
  await run({ ssm, amplify, fetch, ...clock });

  assert.equal(ssm.calls[0].input.Name, '/smart-finances/qa/amplify-app-id');
  const start = amplify.calls.find((c) => c instanceof StartJobCommand);
  assert.deepEqual(start.input, { appId: APP, branchName: 'qa', jobType: 'RELEASE', commitId: SHA });
  const gets = amplify.calls.filter((c) => c instanceof GetJobCommand);
  assert.equal(gets.length, 3);
  assert.deepEqual(gets[0].input, { appId: APP, branchName: 'qa', jobId: '7' });
  assert.ok(fetch.calls.every((c) => c.url.startsWith(`${ORIGIN}/`)));
  assert.ok(fetch.calls.some((c) => c.url === `${ORIGIN}/api/health`));
  assert.ok(fetch.calls.some((c) => c.url === `${ORIGIN}/sign-in`));
});

test('T-WINF-14: a FAILED job fails the release and the health check is not reached', async () => {
  const fetch = fakeFetch();
  const clock = fakeClock();
  await assert.rejects(run({ ssm: fakeSsm(), amplify: fakeAmplify(['RUNNING', 'FAILED']), fetch, ...clock }), /job 7 ended FAILED/);
  assert.equal(fetch.calls.length, 0);
  assert.ok(clock.elapsed() < 60_000, 'fails as soon as the job fails, not at the deadline');
});

test('T-WINF-14: a CANCELLED job fails the release', async () => {
  for (const status of ['CANCELLING', 'CANCELLED']) {
    const clock = fakeClock();
    await assert.rejects(run({ ssm: fakeSsm(), amplify: fakeAmplify([status]), fetch: fakeFetch(), ...clock }), new RegExp(`ended ${status}`));
    assert.equal(clock.elapsed(), 0, 'fails on the first answer, not at the deadline');
  }
});

test('T-WINF-14: a job still running after 15 minutes times out', async () => {
  const clock = fakeClock();
  await assert.rejects(run({ ssm: fakeSsm(), amplify: fakeAmplify(['RUNNING']), fetch: fakeFetch(), ...clock }), /15 minutes/);
  assert.ok(clock.elapsed() >= 15 * 60_000, 'waited the whole 15 minutes');
  assert.ok(clock.elapsed() < 16 * 60_000, 'did not wait much longer than 15 minutes');
});

test('T-WINF-14: health that keeps reporting another sha fails the release', async () => {
  const clock = fakeClock();
  await assert.rejects(
    run({ ssm: fakeSsm(), amplify: fakeAmplify(['SUCCEED']), fetch: fakeFetch({ shas: [OLD_SHA] }), ...clock }),
    new RegExp(`health reports ${OLD_SHA}.*want ${SHA}`),
  );
});

test('T-WINF-14: health that is down until the deadline fails the release; an error answer is retried', async () => {
  await assert.rejects(
    run({ ssm: fakeSsm(), amplify: fakeAmplify(['SUCCEED']), fetch: fakeFetch({ shas: [new Error('connect refused')] }), ...fakeClock() }),
    /health/,
  );
  // One network error, then the right sha: passes.
  await run({ ssm: fakeSsm(), amplify: fakeAmplify(['SUCCEED']), fetch: fakeFetch({ shas: [new Error('reset'), SHA] }), ...fakeClock() });
});

test('T-WINF-14: health on the right sha but the wrong stage fails the release', async () => {
  await assert.rejects(
    run({ ssm: fakeSsm(), amplify: fakeAmplify(['SUCCEED']), fetch: fakeFetch({ stage: 'prod' }), ...fakeClock() }),
    /stage/,
  );
});

test('T-WINF-14: a header that differs from the contract fails the release', async () => {
  const deps = () => ({ ssm: fakeSsm(), amplify: fakeAmplify(['SUCCEED']), ...fakeClock() });
  await assert.rejects(run({ ...deps(), fetch: fakeFetch({ headers: contractHeaders({ 'referrer-policy': 'no-referrer' }) }) }), /Referrer-Policy/i);
  const noCsp = contractHeaders();
  delete noCsp['content-security-policy'];
  await assert.rejects(run({ ...deps(), fetch: fakeFetch({ headers: noCsp }) }), /Content-Security-Policy/i);
});

test('T-WINF-14: checkHeaders accepts the contract and names each difference', () => {
  const h = (o) => new Headers(o);
  assert.deepEqual(checkHeaders(h(contractHeaders())), []);
  // Any nonce and any upload host match, as long as the two nonces agree.
  assert.deepEqual(checkHeaders(h(contractHeaders({ 'content-security-policy': policy('b3RoZXI=', 'uploads.example.test') }))), []);

  const bad = (name, value) => checkHeaders(h(contractHeaders({ [name]: value })));
  assert.match(bad('content-security-policy', policy().replace("'strict-dynamic'", "'unsafe-inline'")).join(), /Content-Security-Policy/);
  assert.match(bad('content-security-policy', policy().replace("object-src 'none'", "object-src 'none'; script-src *")).join(), /Content-Security-Policy/);
  assert.match(bad('content-security-policy', policy().replace(`style-src 'self' 'nonce-${NONCE}'`, "style-src 'self' 'nonce-b3RoZXI='")).join(), /nonce/);
  // A second policy (for example one Amplify custom headers add) arrives joined with a comma and does not match.
  assert.match(bad('content-security-policy', `${policy()}, default-src *`).join(), /Content-Security-Policy/);
  assert.match(bad('strict-transport-security', 'max-age=300').join(), /Strict-Transport-Security/);
  assert.match(bad('x-content-type-options', 'sniff').join(), /X-Content-Type-Options/);
  assert.match(bad('permissions-policy', 'camera=()').join(), /Permissions-Policy/);
  assert.match(bad('referrer-policy', 'no-referrer').join(), /Referrer-Policy/);
});

test('T-WINF-14: the health answer must not be cached', async () => {
  const headers = contractHeaders();
  const fetch = fakeFetch({ headers });
  const plain = async (url, init) => {
    const res = await fetch(url, init);
    const copy = new Headers(res.headers);
    copy.delete('cache-control');
    return new Response(await res.text(), { status: res.status, headers: copy });
  };
  await assert.rejects(run({ ssm: fakeSsm(), amplify: fakeAmplify(['SUCCEED']), fetch: plain, ...fakeClock() }), /Cache-Control/);
});

test('T-WINF-14: a missing or malformed amplify-app-id fails before any job starts', async () => {
  for (const value of [undefined, '', 'not/an-id']) {
    const amplify = fakeAmplify(['SUCCEED']);
    await assert.rejects(run({ ssm: fakeSsm(value), amplify, fetch: fakeFetch(), ...fakeClock() }), /amplify-app-id/);
    assert.equal(amplify.calls.length, 0);
  }
});

test('T-WINF-14: parseArgs needs --stage, --branch and a full --sha', () => {
  assert.deepEqual(parseArgs(['--stage', 'qa', '--branch', 'qa', '--sha', SHA]), { stage: 'qa', branch: 'qa', sha: SHA });
  assert.deepEqual(parseArgs([`--stage=prod`, '--branch=main', `--sha=${SHA}`]), { stage: 'prod', branch: 'main', sha: SHA });
  assert.throws(() => parseArgs(['--stage', 'qa', '--branch', 'qa']), /--sha/);
  assert.throws(() => parseArgs(['--stage', 'qa', '--branch', 'qa', '--sha', 'abc']), /--sha/);
  assert.throws(() => parseArgs(['--stage', 'qa/../x', '--branch', 'qa', '--sha', SHA]), /--stage/);
  assert.throws(() => parseArgs(['--stage', 'qa', '--sha', SHA]), /--branch/);
});
