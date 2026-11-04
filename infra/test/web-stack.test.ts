import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WebStack } from '../lib/web-stack';

const env = { account: '111111111111', region: 'us-east-1' };
const STAGES = ['qa', 'staging', 'prod'];
const retained = (stage: string) => stage === 'staging' || stage === 'prod';
const cdkContext = JSON.parse(readFileSync(join(__dirname, '..', 'cdk.json'), 'utf8')).context as Record<string, unknown>;

// CDK's AwsCustomResource singleton: CDK's own function, not one this repo defines.
const CR_SINGLETON = 'AWS679f53fac002430cb0da5b7982bd2287';

type Resource = { Type: string; Properties: Record<string, any>; DeletionPolicy?: string; UpdateReplacePolicy?: string };

function synth(stage: string) {
  const app = new cdk.App({ context: cdkContext });
  const stack = new WebStack(app, `smart-finances-web-${stage}`, { env, stage });
  const json = Template.fromStack(stack).toJSON();
  return { stack, json, resources: json.Resources as Record<string, Resource> };
}

const ofType = (all: Record<string, Resource>, type: string) => Object.entries(all).filter(([, r]) => r.Type === type);

/**
 * The stage values the stack reads, by name: readStageValues requests the names sorted and
 * answers Parameters.<i>.Value for the i-th, so the custom resource's call tells which is which.
 */
function stageValueNames(all: Record<string, Resource>, stage: string): Map<string, string> {
  const readers = ofType(all, 'Custom::AWS').filter(([id]) => id.startsWith('StageValues'));
  assert.equal(readers.length, 1, 'one stage values reader');
  const call = JSON.parse(readers[0][1].Properties.Create);
  assert.equal(call.action, 'getParameters');
  const byAttribute = new Map<string, string>();
  (call.parameters.Names as string[]).forEach((name, i) => {
    assert.ok(name.startsWith(`/smart-finances/${stage}/`), name);
    byAttribute.set(`${readers[0][0]}.Parameters.${i}.Value`, name.slice(`/smart-finances/${stage}/`.length));
  });
  return byAttribute;
}

/** Renders a template value as a readable string: {{name}} for a stage value, {{Ref:X}} and {{X.Attr}} otherwise. */
function flat(value: any, names: Map<string, string>): string {
  if (typeof value === 'string') return value;
  if (value?.Ref === 'AWS::Partition') return 'aws';
  if (value?.Ref === 'AWS::Region') return 'us-east-1';
  if (value?.Ref === 'AWS::AccountId') return '111111111111';
  if (value?.Ref) return `{{Ref:${value.Ref}}}`;
  if (value?.['Fn::GetAtt']) {
    const key = value['Fn::GetAtt'].join('.');
    return names.has(key) ? `{{${names.get(key)}}}` : `{{${key}}}`;
  }
  if (value?.['Fn::Join']) return value['Fn::Join'][1].map((v: any) => flat(v, names)).join(value['Fn::Join'][0]);
  throw new Error(`cannot flatten ${JSON.stringify(value)}`);
}

/** Every allowed (action, resource) pair a role's inline policies grant, as "action resource" strings. */
function grants(all: Record<string, Resource>, roleId: string, names: Map<string, string>): string[] {
  const pairs: string[] = [];
  for (const [, policy] of ofType(all, 'AWS::IAM::Policy')) {
    const roles = (policy.Properties.Roles as any[]).map((r) => r.Ref);
    if (!roles.includes(roleId)) continue;
    assert.deepEqual(roles, [roleId], 'a policy attaches to one role only');
    for (const s of policy.Properties.PolicyDocument.Statement) {
      assert.equal(s.Effect, 'Allow');
      assert.equal(s.Condition, undefined);
      for (const action of [s.Action].flat()) for (const resource of [s.Resource].flat()) pairs.push(`${action} ${flat(resource, names)}`);
    }
  }
  return pairs.sort();
}

function amplifyRole(all: Record<string, Resource>, id: string) {
  const role = all[id];
  assert.equal(role?.Type, 'AWS::IAM::Role', `${id} is a role`);
  assert.deepEqual(role.Properties.AssumeRolePolicyDocument.Statement, [
    { Action: 'sts:AssumeRole', Effect: 'Allow', Principal: { Service: 'amplify.amazonaws.com' } },
  ]);
  assert.equal(role.Properties.ManagedPolicyArns, undefined, 'no managed policies');
  assert.equal(role.Properties.Policies, undefined, 'no inline policies on the role itself');
  return role;
}

const cross = (actions: string[], resources: string[]) => actions.flatMap((a) => resources.map((r) => `${a} ${r}`));

test('T-WINF-7 sessions table: pk, GSI bySub on sub (keys only), TTL on expires_at, on-demand', () => {
  for (const stage of STAGES) {
    const { stack, resources } = synth(stage);
    const tables = ofType(resources, 'AWS::DynamoDB::Table');
    assert.equal(tables.length, 2, `${stage}: the sessions and the accounts table`);

    const sessions = resources[stack.resolve(stack.sessionsTable.tableName).Ref];
    const p = sessions.Properties;
    assert.deepEqual(p.KeySchema, [{ AttributeName: 'pk', KeyType: 'HASH' }]);
    assert.deepEqual(p.AttributeDefinitions, [
      { AttributeName: 'pk', AttributeType: 'S' },
      { AttributeName: 'sub', AttributeType: 'S' },
    ]);
    assert.equal(p.BillingMode, 'PAY_PER_REQUEST');
    assert.deepEqual(p.TimeToLiveSpecification, { AttributeName: 'expires_at', Enabled: true });
    assert.deepEqual(p.GlobalSecondaryIndexes, [
      { IndexName: 'bySub', KeySchema: [{ AttributeName: 'sub', KeyType: 'HASH' }], Projection: { ProjectionType: 'KEYS_ONLY' } },
    ]);
    assert.ok([undefined, false].includes(p.SSESpecification?.SSEEnabled), 'AWS-owned key');
    // Sessions are short-lived; the table goes with the stack.
    assert.equal(sessions.DeletionPolicy, 'Delete');
  }
});

test('T-WINF-7 accounts table: pk only, no TTL; retained with PITR and deletion protection on staging and prod only', () => {
  for (const stage of STAGES) {
    const { stack, resources } = synth(stage);
    const accounts = resources[stack.resolve(stack.accountsTable.tableName).Ref];
    const p = accounts.Properties;
    assert.deepEqual(p.KeySchema, [{ AttributeName: 'pk', KeyType: 'HASH' }]);
    assert.deepEqual(p.AttributeDefinitions, [{ AttributeName: 'pk', AttributeType: 'S' }]);
    assert.equal(p.BillingMode, 'PAY_PER_REQUEST');
    assert.equal(p.TimeToLiveSpecification, undefined, 'no TTL');
    assert.equal(p.GlobalSecondaryIndexes, undefined);
    if (retained(stage)) {
      assert.equal(accounts.DeletionPolicy, 'Retain', `${stage}: retained`);
      assert.equal(accounts.UpdateReplacePolicy, 'Retain');
      assert.deepEqual(p.PointInTimeRecoverySpecification, { PointInTimeRecoveryEnabled: true });
      assert.equal(p.DeletionProtectionEnabled, true);
    } else {
      // qa alone may destroy the web stack (D-111).
      assert.equal(accounts.DeletionPolicy, 'Delete', `${stage}: removable`);
      assert.ok(!p.PointInTimeRecoverySpecification?.PointInTimeRecoveryEnabled);
      assert.ok(!p.DeletionProtectionEnabled);
    }
  }
});

test('T-WINF-7 HMAC secret: generated in Secrets Manager, only its ARN published as housekeeping-hmac-secret-arn', () => {
  for (const stage of STAGES) {
    const { stack, json, resources } = synth(stage);
    const secrets = ofType(resources, 'AWS::SecretsManager::Secret');
    assert.equal(secrets.length, 1, 'one secret');
    const [[secretId, secret]] = secrets;
    assert.equal(stack.resolve(stack.hmacSecret.secretArn).Ref, secretId);
    assert.equal(secret.Properties.SecretString, undefined, 'the value is generated, never in the template');
    assert.ok(secret.Properties.GenerateSecretString.PasswordLength >= 32);

    const params = ofType(resources, 'AWS::SSM::Parameter').map(([, r]) => r.Properties);
    assert.deepEqual(params.map((r) => r.Name), [`/smart-finances/${stage}/housekeeping-hmac-secret-arn`]);
    assert.deepEqual(params[0].Value, { Ref: secretId });

    assert.equal(json.Outputs, undefined, 'no outputs');
    assert.deepEqual(Object.keys(json.Parameters ?? {}), ['BootstrapVersion']);
  }
});

test('T-WINF-7 compute role: the two secrets, the stage parameters, both tables, three admin calls on this pool; nothing else', () => {
  for (const stage of STAGES) {
    const { stack, resources } = synth(stage);
    const names = stageValueNames(resources, stage);
    assert.deepEqual([...names.values()].sort(), ['amplify-app-id', 'user-pool-id', 'web-client-secret-arn']);

    const roleId = stack.resolve(stack.computeRole.roleArn)['Fn::GetAtt'][0];
    amplifyRole(resources, roleId);

    const sessions = stack.resolve(stack.sessionsTable.tableArn)['Fn::GetAtt'][0];
    const accounts = stack.resolve(stack.accountsTable.tableArn)['Fn::GetAtt'][0];
    const secret = stack.resolve(stack.hmacSecret.secretArn).Ref;
    const tableActions = [
      'dynamodb:BatchGetItem',
      'dynamodb:BatchWriteItem',
      'dynamodb:ConditionCheckItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ];
    const expected = [
      ...cross(['secretsmanager:GetSecretValue'], ['{{web-client-secret-arn}}', `{{Ref:${secret}}}`]),
      ...cross(['ssm:GetParameter', 'ssm:GetParameters'], [`arn:aws:ssm:us-east-1:111111111111:parameter/smart-finances/${stage}/*`]),
      ...cross(tableActions, [`{{${sessions}.Arn}}`, `{{${sessions}.Arn}}/index/*`, `{{${accounts}.Arn}}`]),
      ...cross(
        ['cognito-idp:AdminDeleteUser', 'cognito-idp:AdminGetUser', 'cognito-idp:AdminUserGlobalSignOut'],
        ['arn:aws:cognito-idp:us-east-1:111111111111:userpool/{{user-pool-id}}'],
      ),
    ].sort();
    assert.deepEqual(grants(resources, roleId, names), expected, `${stage}: compute role grants exactly as listed`);
  }
});

test('T-WINF-7 Amplify service role: log writes on /aws/amplify/<app id> only; that existing group gets one-month retention', () => {
  for (const stage of STAGES) {
    const { stack, resources } = synth(stage);
    const names = stageValueNames(resources, stage);

    const roleId = stack.resolve(stack.serviceRole.roleArn)['Fn::GetAtt'][0];
    amplifyRole(resources, roleId);
    const group = 'arn:aws:logs:us-east-1:111111111111:log-group:/aws/amplify/{{amplify-app-id}}';
    assert.deepEqual(grants(resources, roleId, names), cross(['logs:CreateLogStream', 'logs:PutLogEvents'], [`${group}:*`]).sort());

    // D-112: the group is referenced by name, never created here.
    for (const [, lg] of ofType(resources, 'AWS::Logs::LogGroup')) {
      assert.ok(!flat(lg.Properties.LogGroupName ?? '', names).includes('/aws/amplify'), 'the Amplify log group is not created');
    }

    // One custom resource puts the retention on create and update and leaves the group on delete.
    const retention = ofType(resources, 'Custom::AWS').filter(([id]) => !id.startsWith('StageValues'));
    assert.equal(retention.length, 1, 'one retention custom resource');
    const props = retention[0][1].Properties;
    for (const event of ['Create', 'Update']) {
      const call = JSON.parse(flat(props[event], names));
      assert.equal(call.service, 'CloudWatchLogs');
      assert.equal(call.action, 'putRetentionPolicy');
      assert.deepEqual(call.parameters, { logGroupName: '/aws/amplify/{{amplify-app-id}}', retentionInDays: 30 });
    }
    assert.equal(props.Delete, undefined, 'the group and its retention stay on delete');

    // The custom resources share CDK's provider function; its role reads the three stage values
    // and puts that one group's retention, nothing else.
    const providers = ofType(resources, 'AWS::Lambda::Function').filter(([id]) => id.startsWith(CR_SINGLETON));
    assert.equal(providers.length, 1);
    const providerRoleId = providers[0][1].Properties.Role['Fn::GetAtt'][0];
    const param = (n: string) => `arn:aws:ssm:us-east-1:111111111111:parameter/smart-finances/${stage}/${n}`;
    assert.deepEqual(
      grants(resources, providerRoleId, names).filter((g) => !g.startsWith('logs:CreateLogStream') && !g.startsWith('logs:PutLogEvents ')),
      [
        `logs:PutRetentionPolicy ${group}`,
        `logs:PutRetentionPolicy ${group}:*`,
        ...cross(['ssm:GetParameters'], [param('amplify-app-id'), param('user-pool-id'), param('web-client-secret-arn')]),
      ].sort(),
    );
    // Its log writes go to its own group, not to Amplify's.
    for (const g of grants(resources, providerRoleId, names).filter((g) => /^logs:(CreateLogStream|PutLogEvents) /.test(g))) {
      assert.ok(!g.includes('/aws/amplify'), g);
    }
  }
});
