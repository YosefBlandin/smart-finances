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
    const stacks = Object.values(addStage(app, stage, env)).filter((s): s is NonNullable<typeof s> => s !== undefined) as cdk.Stack[];
    assert.equal(stacks.length, stage === 'dev' ? 2 : 4);
    for (const stack of stacks) {
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
    assert.deepEqual(names, ['table-name', 'bucket-name', 'user-pool-id', 'user-pool-client-id', 'web-client-id']
      .map((name) => `/smart-finances/${stage}/${name}`)
      .sort());
  }

  // webOrigins come from context per stage and default to none; they no longer reach the
  // data stack's bucket, whose browser rule the web stack sets (D-88).
  const cors = (stack: cdk.Stack) => {
    const buckets = Object.values(Template.fromStack(stack).findResources('AWS::S3::Bucket'));
    return (buckets[0].Properties.CorsConfiguration?.CorsRules ?? []).flatMap((rule: { AllowedOrigins: string[] }) => rule.AllowedOrigins);
  };
  const withOrigins = addStage(new cdk.App({ context }), 'qa', env);
  assert.deepEqual(cors(withOrigins.data), []);
  assert.deepEqual(withOrigins.api.webOrigins, ['http://localhost:3000']);
  const none = addStage(new cdk.App(), 'qa', env);
  assert.deepEqual(cors(none.data), []);
  assert.deepEqual(none.api.webOrigins, []);
  const staging = addStage(new cdk.App({ context }), 'staging', env);
  assert.deepEqual(cors(staging.data), []);
  assert.deepEqual(staging.api.webOrigins, []);
});

type Resource = { Type: string; Properties: Record<string, any> };

/** An AwsCustomResource's Create call; deploy-time values (Ref, GetAtt) read as {{value}}. */
function createCall(r: Resource): any {
  const flat = (v: any): string => (typeof v === 'string' ? v : v?.['Fn::Join'] ? v['Fn::Join'][1].map(flat).join(v['Fn::Join'][0]) : '{{value}}');
  return r.Properties.Create === undefined ? {} : JSON.parse(flat(r.Properties.Create));
}

/** Parameters a stack creates, by name under /smart-finances/<stage>/. */
function writes(stack: cdk.Stack, stage: string): string[] {
  const resources = Template.fromStack(stack).toJSON().Resources as Record<string, Resource>;
  return Object.values(resources)
    .filter((r) => r.Type === 'AWS::SSM::Parameter')
    .map((r) => {
      assert.equal(typeof r.Properties.Name, 'string', `${stack.stackName} parameter names are literal`);
      assert.ok(r.Properties.Name.startsWith(`/smart-finances/${stage}/`), r.Properties.Name);
      return r.Properties.Name.slice(`/smart-finances/${stage}/`.length);
    });
}

/** Parameters a stack reads at deploy time (its readStageValues custom resource), by name. */
function reads(stack: cdk.Stack, stage: string): string[] {
  const resources = Template.fromStack(stack).toJSON().Resources as Record<string, Resource>;
  return Object.values(resources)
    .filter((r) => r.Type === 'Custom::AWS')
    .map(createCall)
    .filter((call) => call.action === 'getParameters')
    .flatMap((call) => call.parameters.Names as string[])
    .map((name) => {
      assert.ok(name.startsWith(`/smart-finances/${stage}/`), name);
      return name.slice(`/smart-finances/${stage}/`.length);
    });
}

/** Stage parameters a person sets by hand (release.md HUMAN needs); no stack writes them. */
const PERSON_SET = ['amplify-app-id', 'support-address', 'alarm-email', 'monthly-budget-usd'];

test('T-WINF-13 stages deploy data, API, web, alarms in us-east-1, each after the one before; dev has no web or alarms stack', () => {
  for (const stage of STAGES) {
    const app = new cdk.App({ context });
    const result = addStage(app, stage, env);
    const kinds = stage === 'dev' ? ['data', 'api'] : ['data', 'api', 'web', 'alarms'];
    assert.deepEqual(Object.keys(result).filter((k) => (result as Record<string, unknown>)[k] !== undefined), kinds, `${stage} stacks`);
    const ordered = kinds.map((kind) => (result as Record<string, cdk.Stack>)[kind]);
    ordered.forEach((stack, i) => {
      assert.equal(stack.stackName, `smart-finances-${kinds[i]}-${stage}`);
      assert.equal(stack.region, 'us-east-1', `${stack.stackName} is in us-east-1 (D-89)`);
      assert.equal(stack.account, env.account);
      if (i > 0) assert.ok(stack.dependencies.includes(ordered[i - 1]), `${stack.stackName} depends on ${ordered[i - 1].stackName}`);
    });
    // The whole app holds only this stage's stacks.
    assert.deepEqual(app.node.children.filter((c) => c instanceof cdk.Stack).map((s) => (s as cdk.Stack).stackName).sort(),
      ordered.map((s) => s.stackName).sort());
  }

  // Without an env (bin/app.ts with no CDK_DEFAULT_*), the stages are still pinned to us-east-1.
  const bare = addStage(new cdk.App({ context }), 'qa');
  for (const stack of [bare.data, bare.api, bare.web!, bare.alarms!]) assert.equal(stack.region, 'us-east-1');
});

test('T-WINF-13 no stack reads a parameter a later stack writes; every deploy-time read is written earlier or set by a person', () => {
  for (const stage of STAGES) {
    const result = addStage(new cdk.App({ context }), stage, env);
    const ordered = [result.data, result.api, result.web, result.alarms].filter((s) => s !== undefined) as cdk.Stack[];
    const writtenBy = new Map<string, number>();
    ordered.forEach((stack, i) => {
      for (const name of writes(stack, stage)) {
        assert.equal(writtenBy.has(name), false, `${name} is written once`);
        writtenBy.set(name, i);
      }
    });
    for (const name of PERSON_SET) assert.equal(writtenBy.has(name), false, `${name} is set by a person, not a stack`);
    ordered.forEach((stack, i) => {
      for (const name of reads(stack, stage)) {
        const writer = writtenBy.get(name);
        if (writer === undefined) {
          assert.ok(PERSON_SET.includes(name), `${stack.stackName} reads ${name}, which no stack writes and no person sets`);
        } else {
          assert.ok(writer < i, `${stack.stackName} reads ${name}, written by ${ordered[writer].stackName} (not earlier)`);
        }
      }
    });
  }
});

test('T-WINF-13 the web stack gets the stage\'s extra origins from addStage', () => {
  const origins = (stack: cdk.Stack) => {
    const resources = Template.fromStack(stack).toJSON().Resources as Record<string, Resource>;
    const call = Object.values(resources)
      .filter((r) => r.Type === 'Custom::AWS')
      .map(createCall)
      .find((c) => c.action === 'putBucketCors');
    return (call.parameters.CORSConfiguration.CORSRules[0].AllowedOrigins as unknown[]).slice(1);
  };
  const custom = { webOrigins: { qa: ['http://localhost:3999'], staging: ['https://staging.example.test'] } };
  assert.deepEqual(origins(addStage(new cdk.App({ context: custom }), 'qa', env).web!), ['http://localhost:3999']);
  assert.deepEqual(origins(addStage(new cdk.App({ context: custom }), 'staging', env).web!), ['https://staging.example.test']);
  assert.deepEqual(origins(addStage(new cdk.App(), 'prod', env).web!), []);
});
