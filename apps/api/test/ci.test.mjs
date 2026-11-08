import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const lines = workflow.split('\n');
const lineOf = (pattern) => {
  const found = lines.findIndex((line) => pattern.test(line));
  assert.ok(found >= 0, `deploy.yml has a line matching ${pattern}`);
  return found;
};

test('T-CI-1 deploy.yml runs npm test before credentials and deploys data, api, web and alarms in order, then releases', () => {
  const install = lineOf(/^\s*- run: npm ci\s*$/);
  const tests = lineOf(/^\s*(- )?run: npm test\s*$/);
  const credentials = lineOf(/uses: aws-actions\/configure-aws-credentials@/);
  const deployData = lineOf(/cdk deploy "smart-finances-data-\$\{STAGE\}" -c stage="\$\{STAGE\}"/);
  const deployApi = lineOf(/cdk deploy "smart-finances-api-\$\{STAGE\}" -c stage="\$\{STAGE\}"/);

  assert.ok(install < tests, 'npm test runs after npm ci');
  assert.ok(tests < credentials, 'npm test runs before AWS credentials exist');
  assert.ok(credentials < deployData, 'deploys run with credentials');
  assert.ok(deployData < deployApi, 'the data stack deploys before the api stack');
  // SF-132 (D-93, owner decision in the SF-132 deviation): then the web and alarms stacks, then the Amplify release.
  const deployWeb = lineOf(/cdk deploy "smart-finances-web-\$\{STAGE\}" -c stage="\$\{STAGE\}"/);
  const deployAlarms = lineOf(/cdk deploy "smart-finances-alarms-\$\{STAGE\}" -c stage="\$\{STAGE\}"/);
  const release = lineOf(/run: node scripts\/amplify-release\.mjs /);
  assert.ok(deployApi < deployWeb, 'the web stack deploys after the api stack');
  assert.ok(deployWeb < deployAlarms, 'the alarms stack deploys after the web stack');
  assert.ok(deployAlarms < release, 'the Amplify release runs after every stack is deployed');
  assert.equal(lines.filter((line) => /cdk deploy/.test(line)).length, 4, 'exactly the four stage stacks are deployed');
});

test('T-WEB-17 the Lighthouse budgets block the deploy on every stage, qa included, before AWS credentials exist', () => {
  const step = lineOf(/- name: Lighthouse CI budgets/);
  const credentials = lineOf(/uses: aws-actions\/configure-aws-credentials@/);
  assert.ok(step < credentials, 'the budgets run before credentials');
  const block = lines.slice(step, credentials).join('\n');
  // The qa allowance of 2026-11-07 is gone now that the run measures the real money screens.
  assert.doesNotMatch(block, /continue-on-error/);
  assert.match(block, /STAGE: test/);
  assert.match(block, /run: npm run lhci --workspace @smart-finances\/web/);
  assert.doesNotMatch(workflow, /continue-on-error/, 'no step of the deploy may fail quietly');
});
