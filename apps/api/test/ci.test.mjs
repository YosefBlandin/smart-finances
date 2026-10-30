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

test('T-CI-1 deploy.yml runs npm test before credentials and deploys the data stack before the api stack', () => {
  const install = lineOf(/^\s*- run: npm ci\s*$/);
  const tests = lineOf(/^\s*(- )?run: npm test\s*$/);
  const credentials = lineOf(/uses: aws-actions\/configure-aws-credentials@/);
  const deployData = lineOf(/cdk deploy "smart-finances-data-\$\{STAGE\}" -c stage="\$\{STAGE\}"/);
  const deployApi = lineOf(/cdk deploy "smart-finances-api-\$\{STAGE\}" -c stage="\$\{STAGE\}"/);

  assert.ok(install < tests, 'npm test runs after npm ci');
  assert.ok(tests < credentials, 'npm test runs before AWS credentials exist');
  assert.ok(credentials < deployData, 'deploys run with credentials');
  assert.ok(deployData < deployApi, 'the data stack deploys before the api stack');
  assert.equal(lines.filter((line) => /cdk deploy/.test(line)).length, 2, 'exactly the two stage stacks are deployed');
});
