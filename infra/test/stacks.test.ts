import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { addStage } from '../lib/stage';

const env = { account: '111111111111', region: 'us-east-1' };
const STAGES = ['dev', 'qa', 'staging', 'prod'];
const context = {
  webOrigins: { dev: ['http://localhost:3000'], qa: ['http://localhost:3000'], staging: [], prod: [] },
};

test('T-INF-1 every stack of a stage synthesizes', () => {
  for (const stage of STAGES) {
    const app = new cdk.App({ context });
    const { data, api } = addStage(app, stage, env);
    for (const stack of [data, api]) {
      const template = Template.fromStack(stack);
      assert.ok(Object.keys(template.toJSON().Resources).length > 0, `${stack.stackName} has resources`);
    }
  }
});

const deepFind = (value: unknown, key: string): boolean =>
  typeof value === 'object' && value !== null &&
  Object.entries(value).some(([k, v]) => k === key || deepFind(v, key));

test('T-INF-6 each stage has a data and an api stack; the api stack depends on the data stack and uses no imports', () => {
  for (const stage of STAGES) {
    const app = new cdk.App({ context });
    const { data, api } = addStage(app, stage, env);
    assert.equal(data.stackName, `smart-finances-data-${stage}`);
    assert.equal(api.stackName, `smart-finances-api-${stage}`);
    assert.ok(api.dependencies.includes(data), `${stage} api stack depends on the data stack`);

    const apiJson = Template.fromStack(api).toJSON();
    const dataJson = Template.fromStack(data).toJSON();
    assert.equal(deepFind(apiJson, 'Fn::ImportValue'), false, 'no CloudFormation imports in the api stack');
    const exports = Object.values((dataJson.Outputs ?? {}) as Record<string, { Export?: unknown }>).filter((o) => o.Export);
    assert.deepEqual(exports, [], 'no CloudFormation exports from the data stack');

    // The api stack reads the data stack's values from SSM through one custom resource (D-33),
    // not through SSM-typed template parameters.
    const ssmParams = Object.entries((apiJson.Parameters ?? {}) as Record<string, { Type: string }>)
      .filter(([id, p]) => p.Type.startsWith('AWS::SSM::Parameter::Value') && id !== 'BootstrapVersion');
    assert.deepEqual(ssmParams, [], `${stage} api stack has no SSM template parameters`);
    const readers = Object.values(apiJson.Resources as Record<string, { Type: string; Properties: any }>)
      .filter((r) => r.Type === 'Custom::AWS');
    assert.equal(readers.length, 1);
    const names = JSON.parse(readers[0].Properties.Create).parameters.Names;
    assert.deepEqual(names, ['table-name', 'bucket-name', 'user-pool-id', 'user-pool-client-id']
      .map((name) => `/smart-finances/${stage}/${name}`)
      .sort());
  }

  // webOrigins come from context per stage, reach both stacks, and default to none.
  const cors = (stack: cdk.Stack) => {
    const buckets = Object.values(Template.fromStack(stack).findResources('AWS::S3::Bucket'));
    return (buckets[0].Properties.CorsConfiguration?.CorsRules ?? []).flatMap((rule: { AllowedOrigins: string[] }) => rule.AllowedOrigins);
  };
  const withOrigins = addStage(new cdk.App({ context }), 'qa', env);
  assert.deepEqual(cors(withOrigins.data), ['http://localhost:3000']);
  assert.deepEqual(withOrigins.api.webOrigins, ['http://localhost:3000']);
  const none = addStage(new cdk.App(), 'qa', env);
  assert.deepEqual(cors(none.data), []);
  assert.deepEqual(none.api.webOrigins, []);
  const staging = addStage(new cdk.App({ context }), 'staging', env);
  assert.deepEqual(cors(staging.data), []);
  assert.deepEqual(staging.api.webOrigins, []);
});
