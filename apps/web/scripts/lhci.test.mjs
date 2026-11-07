// T-WEB-17: Lighthouse CI budgets (D-134). Phone settings against `next start` with STAGE=test on every money page:
// largest contentful paint at most 2.5 s, layout shift at most 0.1, first-load JavaScript at most 200 KB per route.
// Runs with `node --test scripts/lhci.test.mjs` (first step of `npm run lhci`): it checks the config, then feeds
// synthetic Lighthouse results to `lhci assert` to prove a breach fails the run and a run within budget passes.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(web, 'lighthouserc.json');
const readConfig = () => JSON.parse(readFileSync(configPath, 'utf8'));

const LCP_MS = 2500;
const CLS = 0.1;
const JS_BYTES = 200 * 1024;

// The money routes as the middleware names them, so a new money page cannot skip the budgets.
function moneyRoutes() {
  const source = readFileSync(join(web, 'src', 'middleware.ts'), 'utf8');
  const list = /const MONEY_ROUTES = \[([^\]]*)\]/.exec(source)?.[1] ?? '';
  return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('T-WEB-17: lighthouserc.json runs phone settings against next start with STAGE=test on every money page', () => {
  const { collect } = readConfig().ci;
  assert.match(collect.startServerCommand, /\bSTAGE=test\b/);
  assert.match(collect.startServerCommand, /\bnext start\b/);
  assert.doesNotMatch(collect.startServerCommand, /\bnext dev\b/);

  const routes = moneyRoutes();
  assert.ok(routes.length >= 6, `money routes found in middleware.ts: ${routes.join(', ')}`);
  const paths = collect.url.map((u) => new URL(u).pathname).sort();
  assert.deepEqual(paths, [...routes].sort());

  // Phone: Lighthouse's mobile form factor with its mobile screen and simulated slow 4G, not the desktop preset.
  const s = collect.settings ?? {};
  assert.equal(s.preset, undefined);
  assert.equal(s.formFactor, 'mobile');
  assert.equal(s.screenEmulation?.mobile ?? true, true);
  assert.notEqual(s.throttlingMethod, 'provided');
  // Several runs per page, judged on each metric's median, so one noisy run neither passes nor fails the budget.
  assert.ok(collect.numberOfRuns >= 3);
  assert.equal(readConfig().ci.assert.aggregationMethod, 'median');
  // The money pages need a session cookie to pass the middleware; any value does until PR 3.
  assert.match(s.extraHeaders?.Cookie ?? '', /__Host-sid=/);
});

test('T-WEB-17: the budgets are LCP 2.5 s, CLS 0.1 and 200 KB of first-load JavaScript, each failing the run', () => {
  const { assertions } = readConfig().ci.assert;
  assert.deepEqual(assertions['largest-contentful-paint'], ['error', { maxNumericValue: LCP_MS }]);
  assert.deepEqual(assertions['cumulative-layout-shift'], ['error', { maxNumericValue: CLS }]);
  assert.deepEqual(assertions['resource-summary:script:size'], ['error', { maxNumericValue: JS_BYTES }]);
});

// A minimal Lighthouse result with the three measured values for one page.
function lhr(url, { lcp, cls, js }) {
  return {
    lighthouseVersion: '12.6.1',
    requestedUrl: url,
    finalUrl: url,
    finalDisplayedUrl: url,
    fetchTime: '2026-10-30T00:00:00.000Z',
    runWarnings: [],
    configSettings: { formFactor: 'mobile' },
    categories: {},
    audits: {
      'largest-contentful-paint': { id: 'largest-contentful-paint', score: lcp <= LCP_MS ? 1 : 0, numericValue: lcp },
      'cumulative-layout-shift': { id: 'cumulative-layout-shift', score: cls <= CLS ? 1 : 0, numericValue: cls },
      'resource-summary': {
        id: 'resource-summary',
        score: null,
        details: {
          type: 'table',
          items: [
            { resourceType: 'total', label: 'Total', requestCount: 4, transferSize: js + 20000 },
            { resourceType: 'script', label: 'Script', requestCount: 3, transferSize: js },
            { resourceType: 'document', label: 'Document', requestCount: 1, transferSize: 20000 },
          ],
        },
      },
    },
  };
}

// The lhci command line, wherever npm put the package.
const bin = join(dirname(createRequire(import.meta.url).resolve('@lhci/cli/package.json')), 'src', 'cli.js');

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

// Run `lhci assert` with this repo's config over synthetic results, one per money page.
function assertRun(values) {
  const dir = mkdtempSync(join(tmpdir(), 'lhci-t-web-17-'));
  dirs.push(dir);
  mkdirSync(join(dir, '.lighthouseci'));
  readConfig().ci.collect.url.forEach((url, i) => {
    writeFileSync(join(dir, '.lighthouseci', `lhr-${i}.json`), JSON.stringify(lhr(url, values(url))));
  });
  const run = spawnSync(process.execPath, [bin, 'assert', `--config=${configPath}`], { cwd: dir, encoding: 'utf8' });
  return { code: run.status, out: `${run.stdout}\n${run.stderr}` };
}

const within = { lcp: 1800, cls: 0.02, js: 150 * 1024 };

test('T-WEB-17: a run within the budgets passes', () => {
  const run = assertRun(() => within);
  assert.equal(run.code, 0, run.out);
});

test('T-WEB-17: a page over any one budget fails the run', () => {
  for (const [audit, breach] of [
    ['largest-contentful-paint', { lcp: 2600 }],
    ['cumulative-layout-shift', { cls: 0.15 }],
    ['resource-summary', { js: JS_BYTES + 1024 }],
  ]) {
    const run = assertRun((url) => (new URL(url).pathname === '/transactions' ? { ...within, ...breach } : within));
    assert.notEqual(run.code, 0, `${audit} breach passed:\n${run.out}`);
    assert.match(run.out, /failure for .*maxNumericValue.* assertion/);
    assert.match(run.out, new RegExp(audit));
    assert.match(run.out, /\/transactions/);
  }
});

test('T-WEB-17: npm run lhci builds, then collects and asserts with this config', () => {
  const pkg = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8'));
  const script = pkg.scripts.lhci ?? '';
  assert.match(script, /node --test scripts\/lhci\.test\.mjs/);
  assert.match(script, /next build/);
  assert.match(script, /lhci collect/);
  assert.match(script, /lhci assert/);
  assert.ok(pkg.devDependencies['@lhci/cli'], '@lhci/cli is a dev dependency');
  // The binary answers (installed and runnable).
  assert.match(execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf8' }), /\d+\.\d+\.\d+/);
});
