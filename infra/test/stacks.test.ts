import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ApiStack } from '../lib/api-stack';

const env = { account: '111111111111', region: 'us-east-1' };

test('T-INF-1 every stack of a stage synthesizes', () => {
  for (const stage of ['dev', 'qa', 'staging', 'prod']) {
    const app = new cdk.App();
    const api = new ApiStack(app, `smart-finances-api-${stage}`, { env, stage });
    const template = Template.fromStack(api);
    assert.ok(Object.keys(template.toJSON().Resources).length > 0, `${stage} api stack has resources`);
  }
});
