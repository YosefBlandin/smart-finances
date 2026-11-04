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
      if ([s.Action].flat().includes('iam:PassRole')) {
        assert.deepEqual(s.Condition, { StringEquals: { 'iam:PassedToService': 'amplify.amazonaws.com' } }, 'roles pass to Amplify only');
        assert.deepEqual([s.Action].flat(), ['iam:PassRole'], 'the PassRole statement grants nothing else');
      } else assert.equal(s.Condition, undefined);
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

/** Every name the stack reads from /smart-finances/<stage>/ at deploy time, sorted. */
const STAGE_VALUES = ['amplify-app-id', 'api-url', 'bucket-name', 'support-address', 'user-pool-id', 'web-client-id', 'web-client-secret-arn'];

/** CDK's AwsCustomResource provider function's role, shared by every SDK-call custom resource here. */
function providerRole(all: Record<string, Resource>): string {
  const providers = ofType(all, 'AWS::Lambda::Function').filter(([id]) => id.startsWith(CR_SINGLETON));
  assert.equal(providers.length, 1, 'one AwsCustomResource provider');
  return providers[0][1].Properties.Role['Fn::GetAtt'][0];
}

type SdkCall = { service: string; action: string; parameters: Record<string, any>; outputPaths?: string[]; ignoreErrorCodesMatching?: string; logApiResponseData?: boolean };

/** The SDK-call custom resources other than the stage values reader, with their Create call flattened. */
function sdkCalls(all: Record<string, Resource>, names: Map<string, string>): [string, SdkCall, Resource][] {
  return ofType(all, 'Custom::AWS')
    .filter(([id]) => !id.startsWith('StageValues'))
    .map(([id, r]) => [id, JSON.parse(flat(r.Properties.Create, names)) as SdkCall, r]);
}

const event = (r: Resource, key: 'Create' | 'Update' | 'Delete', names: Map<string, string>): SdkCall =>
  JSON.parse(flat(r.Properties[key], names));

const BRANCH: Record<string, string> = { qa: 'qa', staging: 'staging', prod: 'main' };
const PASSED_TO_AMPLIFY = { StringEquals: { 'iam:PassedToService': 'amplify.amazonaws.com' } };

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
    assert.deepEqual([...names.values()].sort(), STAGE_VALUES);

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
    const retention = sdkCalls(resources, names).filter(([, call]) => call.action === 'putRetentionPolicy');
    assert.equal(retention.length, 1, 'one retention custom resource');
    const props = retention[0][2].Properties;
    for (const event of ['Create', 'Update']) {
      const call = JSON.parse(flat(props[event], names));
      assert.equal(call.service, 'CloudWatchLogs');
      assert.equal(call.action, 'putRetentionPolicy');
      assert.deepEqual(call.parameters, { logGroupName: '/aws/amplify/{{amplify-app-id}}', retentionInDays: 30 });
    }
    assert.equal(props.Delete, undefined, 'the group and its retention stay on delete');

    // The custom resources share CDK's provider function; its role reads the stage values and puts
    // that one group's retention (T-WINF-8 pins the rest of its grants).
    const providerRoleId = providerRole(resources);
    const param = (n: string) => `arn:aws:ssm:us-east-1:111111111111:parameter/smart-finances/${stage}/${n}`;
    assert.deepEqual(
      grants(resources, providerRoleId, names).filter((g) => g.startsWith('logs:PutRetentionPolicy ') || g.startsWith('ssm:')),
      [`logs:PutRetentionPolicy ${group}`, `logs:PutRetentionPolicy ${group}:*`, ...cross(['ssm:GetParameters'], STAGE_VALUES.map(param))].sort(),
    );
    // Its log writes go to its own group, not to Amplify's.
    for (const g of grants(resources, providerRoleId, names).filter((g) => /^logs:(CreateLogStream|PutLogEvents) /.test(g))) {
      assert.ok(!g.includes('/aws/amplify'), g);
    }
  }
});

test('T-WINF-8 app update: platform WEB_COMPUTE, the service and compute roles; delete clears both roles', () => {
  for (const stage of STAGES) {
    const { stack, resources } = synth(stage);
    const names = stageValueNames(resources, stage);
    const service = `{{${stack.resolve(stack.serviceRole.roleArn)['Fn::GetAtt'][0]}.Arn}}`;
    const compute = `{{${stack.resolve(stack.computeRole.roleArn)['Fn::GetAtt'][0]}.Arn}}`;

    const apps = sdkCalls(resources, names).filter(([, call]) => call.action === 'updateApp');
    assert.equal(apps.length, 1, `${stage}: one app update`);
    const [, , app] = apps[0];
    for (const key of ['Create', 'Update'] as const) {
      const call = event(app, key, names);
      assert.equal(call.service, 'Amplify');
      assert.deepEqual(call.parameters, { appId: '{{amplify-app-id}}', platform: 'WEB_COMPUTE', iamServiceRoleArn: service, computeRoleArn: compute });
      // The answer holds the app's settings: nothing of it goes to CloudFormation or the log.
      assert.deepEqual(call.outputPaths, ['app.appId']);
      assert.equal(call.logApiResponseData, false);
    }
    const clear = event(app, 'Delete', names);
    assert.deepEqual(clear.parameters, { appId: '{{amplify-app-id}}', iamServiceRoleArn: '', computeRoleArn: '' }, 'delete clears the roles it set, nothing else');
    assert.equal(clear.ignoreErrorCodesMatching, 'NotFoundException');
    assert.equal(clear.logApiResponseData, false);
    // One physical id per app, so a stack update never runs the delete against a live app.
    assert.equal(JSON.parse(flat(app.Properties.Create, names)).physicalResourceId.id, 'amplify-app/{{amplify-app-id}}');
  }
});

test('T-WINF-8 branch update: auto-build off and the compute role on the stage branch; delete clears the role', () => {
  for (const stage of STAGES) {
    const { stack, resources } = synth(stage);
    const names = stageValueNames(resources, stage);
    const compute = `{{${stack.resolve(stack.computeRole.roleArn)['Fn::GetAtt'][0]}.Arn}}`;
    assert.equal(stack.branchName, BRANCH[stage]);

    const branches = sdkCalls(resources, names).filter(([, call]) => call.action === 'updateBranch');
    assert.equal(branches.length, 1, `${stage}: one branch update`);
    const [id, , branch] = branches[0];
    for (const key of ['Create', 'Update'] as const) {
      const call = event(branch, key, names);
      assert.equal(call.service, 'Amplify');
      assert.deepEqual(call.parameters, { appId: '{{amplify-app-id}}', branchName: BRANCH[stage], enableAutoBuild: false, computeRoleArn: compute });
      assert.deepEqual(call.outputPaths, ['branch.branchName']);
      assert.equal(call.logApiResponseData, false);
    }
    const clear = event(branch, 'Delete', names);
    assert.deepEqual(clear.parameters, { appId: '{{amplify-app-id}}', branchName: BRANCH[stage], computeRoleArn: '' }, 'auto-build stays off');
    assert.equal(clear.ignoreErrorCodesMatching, 'NotFoundException');

    // The app is web compute before its branch takes the compute role.
    const appId = sdkCalls(resources, names).find(([, call]) => call.action === 'updateApp')![0];
    assert.ok((branch as any).DependsOn?.includes(appId), `${id} waits for the app update`);
  }
});

test('T-WINF-8 branch variables: one merging custom resource with exactly the contract names, no secret value', () => {
  for (const stage of STAGES) {
    const { stack, resources } = synth(stage);
    const names = stageValueNames(resources, stage);
    assert.deepEqual([...names.values()].sort(), STAGE_VALUES);

    const vars = ofType(resources, 'Custom::AmplifyBranchVariables');
    assert.equal(vars.length, 1, `${stage}: one variables resource`);
    const [varsId, v] = vars[0];
    const p = v.Properties;
    assert.equal(flat(p.AppId, names), '{{amplify-app-id}}');
    assert.equal(p.BranchName, BRANCH[stage]);
    const sessions = stack.resolve(stack.sessionsTable.tableName).Ref;
    const accounts = stack.resolve(stack.accountsTable.tableName).Ref;
    const hmac = stack.resolve(stack.hmacSecret.secretArn).Ref;
    const variables = Object.fromEntries(Object.entries(p.Variables).map(([k, val]) => [k, flat(val, names)]));
    // Contracts "Web server settings": every name WebStack writes (COMMIT_SHA is amplify.yml's).
    assert.deepEqual(variables, {
      STAGE: stage,
      AWS_REGION: 'us-east-1',
      API_URL: '{{api-url}}',
      USER_POOL_ID: '{{user-pool-id}}',
      WEB_CLIENT_ID: '{{web-client-id}}',
      WEB_CLIENT_SECRET_ARN: '{{web-client-secret-arn}}',
      HMAC_SECRET_ARN: `{{Ref:${hmac}}}`,
      SESSIONS_TABLE: `{{Ref:${sessions}}}`,
      ACCOUNTS_TABLE: `{{Ref:${accounts}}}`,
      UPLOAD_HOST: '{{bucket-name}}.s3.us-east-1.amazonaws.com',
      WEB_ORIGIN: `https://${BRANCH[stage]}.{{amplify-app-id}}.amplifyapp.com`,
      SUPPORT_ADDRESS: '{{support-address}}',
    });
    // No secret value: the only secret in the stack is referenced by its ARN (Ref), never resolved.
    assert.ok(!JSON.stringify(p).includes('resolve:secretsmanager'), 'no dynamic secret reference');
    assert.ok(!JSON.stringify(p).includes('SecretString'), 'no secret string');

    // The variables are merged after the branch update, by the repo's own function.
    const branchId = sdkCalls(resources, names).find(([, call]) => call.action === 'updateBranch')![0];
    assert.ok((v as any).DependsOn?.includes(branchId), `${varsId} waits for the branch update`);

    const fns = ofType(resources, 'AWS::Lambda::Function').filter(([, f]) => f.Properties.FunctionName === `smart-finances-${stage}-amplify-vars`);
    assert.equal(fns.length, 1, 'the amplify-vars function');
    const [, fn] = fns[0];
    assert.deepEqual(fn.Properties.Environment.Variables, { STAGE: stage }, 'no settings in its environment');
    const fnRoleId = fn.Properties.Role['Fn::GetAtt'][0];
    const branchArn = `arn:aws:amplify:us-east-1:111111111111:apps/{{amplify-app-id}}/branches/${BRANCH[stage]}`;
    assert.deepEqual(
      grants(resources, fnRoleId, names).filter((g) => !/^logs:(CreateLogStream|PutLogEvents) /.test(g)),
      cross(['amplify:GetBranch', 'amplify:UpdateBranch'], [branchArn]).sort(),
      'get and put this branch only; it passes no role',
    );
  }
});

test('T-WINF-8 iam:PassRole only on the two roles, only to Amplify, only for the app and branch updates', () => {
  for (const stage of STAGES) {
    const { stack, resources } = synth(stage);
    const names = stageValueNames(resources, stage);
    const service = `{{${stack.resolve(stack.serviceRole.roleArn)['Fn::GetAtt'][0]}.Arn}}`;
    const compute = `{{${stack.resolve(stack.computeRole.roleArn)['Fn::GetAtt'][0]}.Arn}}`;
    const providerRoleId = providerRole(resources);

    // Across every policy in the stack: who may pass which role.
    const passes: string[] = [];
    for (const [, policy] of ofType(resources, 'AWS::IAM::Policy')) {
      for (const s of policy.Properties.PolicyDocument.Statement) {
        if (![s.Action].flat().some((a: string) => a === 'iam:PassRole' || a.startsWith('iam:*') || a === '*')) continue;
        assert.deepEqual(s.Condition, PASSED_TO_AMPLIFY);
        for (const role of policy.Properties.Roles) for (const r of [s.Resource].flat()) passes.push(`${role.Ref} ${flat(r, names)}`);
      }
    }
    assert.deepEqual(passes.sort(), [`${providerRoleId} ${compute}`, `${providerRoleId} ${compute}`, `${providerRoleId} ${service}`].sort());

    // The provider role's whole grant set: its log writes, the stage values, the retention, and the two updates.
    const group = 'arn:aws:logs:us-east-1:111111111111:log-group:/aws/amplify/{{amplify-app-id}}';
    const param = (n: string) => `arn:aws:ssm:us-east-1:111111111111:parameter/smart-finances/${stage}/${n}`;
    const app = 'arn:aws:amplify:us-east-1:111111111111:apps/{{amplify-app-id}}';
    assert.deepEqual(
      grants(resources, providerRoleId, names).filter((g) => !/^logs:(CreateLogStream|PutLogEvents) /.test(g)),
      [
        `amplify:UpdateApp ${app}`,
        `amplify:UpdateBranch ${app}/branches/${BRANCH[stage]}`,
        `iam:PassRole ${compute}`,
        `iam:PassRole ${compute}`,
        `iam:PassRole ${service}`,
        `logs:PutRetentionPolicy ${group}`,
        `logs:PutRetentionPolicy ${group}:*`,
        ...cross(['ssm:GetParameters'], STAGE_VALUES.map(param)),
      ].sort(),
    );
  }
});

test('T-WINF-8 no stage without an Amplify branch: dev and unknown stages are refused', () => {
  for (const stage of ['dev', 'test']) {
    const app = new cdk.App({ context: cdkContext });
    assert.throws(() => new WebStack(app, `smart-finances-web-${stage}`, { env, stage }), /branch/);
  }
});
