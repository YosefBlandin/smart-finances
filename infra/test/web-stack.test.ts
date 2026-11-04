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

type SdkCall = { service: string; action: string; parameters: Record<string, any>; outputPaths?: string[]; ignoreErrorCodesMatching?: string; logApiResponseData?: boolean; physicalResourceId?: { id: string } };

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

    // The HMAC secret's ARN is published once; no other parameter refers to the secret (the whole
    // set of published names is pinned in T-WINF-15).
    const params = ofType(resources, 'AWS::SSM::Parameter').map(([, r]) => r.Properties);
    const hmac = params.filter((r) => r.Name === `/smart-finances/${stage}/housekeeping-hmac-secret-arn`);
    assert.equal(hmac.length, 1);
    assert.deepEqual(hmac[0].Value, { Ref: secretId });
    for (const r of params) if (r !== hmac[0]) assert.ok(!JSON.stringify(r.Value).includes(secretId), `${r.Name} does not refer to the secret`);

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

    // The provider role's whole grant set: its log writes, the stage values, the retention, the two
    // updates and the upload bucket's rule (T-WINF-9).
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
        's3:PutBucketCORS arn:aws:s3:::{{bucket-name}}',
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

test('T-WINF-9 upload bucket rule: POST from the branch address and the stage cdk.json origins, set on the bucket named by bucket-name', () => {
  const origins = cdkContext.webOrigins as Record<string, string[]>;
  for (const stage of STAGES) {
    const { resources } = synth(stage);
    const names = stageValueNames(resources, stage);
    const branchAddress = `https://${BRANCH[stage]}.{{amplify-app-id}}.amplifyapp.com`;
    const rule = { CORSRules: [{ AllowedMethods: ['POST'], AllowedOrigins: [branchAddress, ...(origins[stage] ?? [])] }] };

    const cors = sdkCalls(resources, names).filter(([, call]) => call.service === 'S3');
    assert.equal(cors.length, 1, `${stage}: one bucket rule custom resource`);
    const [, , r] = cors[0];
    for (const key of ['Create', 'Update'] as const) {
      const call = event(r, key, names);
      assert.equal(call.action, 'putBucketCors');
      // The same rule the data stack used to set (POST only, the origins as they are), plus the branch address.
      assert.deepEqual(call.parameters, { Bucket: '{{bucket-name}}', CORSConfiguration: rule });
    }
    // One physical id per bucket, so an origin change is an update, never a delete of the live rule.
    assert.equal(event(r, 'Create', names).physicalResourceId?.id, 'bucket-cors/{{bucket-name}}');
    // The stack's rule goes with the stack (destroyed on qa only, D-111).
    const clear = event(r, 'Delete', names);
    assert.equal(clear.action, 'deleteBucketCors');
    assert.deepEqual(clear.parameters, { Bucket: '{{bucket-name}}' });
    assert.equal(clear.ignoreErrorCodesMatching, 'NoSuchBucket');

    // Only this bucket's rule: the provider role may put (and delete) the CORS rule of that one bucket.
    const s3Grants = grants(resources, providerRole(resources), names).filter((g) => g.startsWith('s3:'));
    assert.deepEqual(s3Grants, ['s3:PutBucketCORS arn:aws:s3:::{{bucket-name}}']);
    // The stack still creates no bucket: the data stack owns it.
    assert.equal(ofType(resources, 'AWS::S3::Bucket').length, 0);
  }

  // The stage's origins are passed through unchanged, in order.
  const app = new cdk.App({ context: { ...cdkContext, webOrigins: { staging: ['https://b.example.test', 'https://a.example.test'] } } });
  const stack = new WebStack(app, 'smart-finances-web-staging', { env, stage: 'staging' });
  const all = Template.fromStack(stack).toJSON().Resources as Record<string, Resource>;
  const names = stageValueNames(all, 'staging');
  const [, call] = sdkCalls(all, names).find(([, c]) => c.service === 'S3')!;
  assert.deepEqual(call.parameters.CORSConfiguration.CORSRules[0].AllowedOrigins, [
    'https://staging.{{amplify-app-id}}.amplifyapp.com',
    'https://b.example.test',
    'https://a.example.test',
  ]);
});

/** The housekeeping function of a stage's template, with its role id. */
function housekeeping(all: Record<string, Resource>, stage: string) {
  const fns = ofType(all, 'AWS::Lambda::Function').filter(([, f]) => f.Properties.FunctionName === `smart-finances-${stage}-housekeeping`);
  assert.equal(fns.length, 1, `${stage}: one housekeeping function`);
  const [id, fn] = fns[0];
  return { id, fn, roleId: fn.Properties.Role['Fn::GetAtt'][0] as string };
}

test('T-WINF-10 T-WINF-11 housekeeping runs hourly with the pool, the tables, the branch health address and the delete-function-name parameter name', () => {
  for (const stage of STAGES) {
    const { stack, resources } = synth(stage);
    const names = stageValueNames(resources, stage);
    // delete-function-name may be missing until data PR 3, so it is never read at deploy time:
    // the deploy-time reader still asks for the same names only.
    assert.deepEqual([...names.values()].sort(), STAGE_VALUES);

    const { id, fn } = housekeeping(resources, stage);
    assert.equal(fn.Properties.Runtime, 'nodejs22.x');
    const env = Object.fromEntries(Object.entries(fn.Properties.Environment.Variables).map(([k, v]) => [k, flat(v, names)]));
    assert.deepEqual(env, {
      STAGE: stage,
      USER_POOL_ID: '{{user-pool-id}}',
      SESSIONS_TABLE: `{{Ref:${stack.resolve(stack.sessionsTable.tableName).Ref}}}`,
      ACCOUNTS_TABLE: `{{Ref:${stack.resolve(stack.accountsTable.tableName).Ref}}}`,
      HEALTH_URL: `https://${BRANCH[stage]}.{{amplify-app-id}}.amplifyapp.com/api/health`,
      DELETE_FUNCTION_PARAMETER: `/smart-finances/${stage}/delete-function-name`,
    });
    // Up to a few deletions of 25 s each, well inside the hour.
    assert.ok(fn.Properties.Timeout >= 120 && fn.Properties.Timeout <= 900, `timeout ${fn.Properties.Timeout}`);

    // Hourly, and one run means one health call: no automatic retry of a failed run.
    const rules = ofType(resources, 'AWS::Events::Rule');
    assert.equal(rules.length, 1, `${stage}: one schedule`);
    const rule = rules[0][1].Properties;
    assert.equal(rule.ScheduleExpression, 'rate(1 hour)');
    assert.equal(rule.State, 'ENABLED');
    assert.deepEqual(rule.Targets.map((t: any) => t.Arn['Fn::GetAtt'][0]), [id]);
    const invokeConfigs = ofType(resources, 'AWS::Lambda::EventInvokeConfig').filter(([, c]) => c.Properties.FunctionName.Ref === id);
    assert.equal(invokeConfigs.length, 1);
    assert.equal(invokeConfigs[0][1].Properties.MaximumRetryAttempts, 0);
    const permissions = ofType(resources, 'AWS::Lambda::Permission').filter(([, p]) => p.Properties.FunctionName['Fn::GetAtt']?.[0] === id);
    assert.deepEqual(permissions.map(([, p]) => p.Properties.Principal), ['events.amazonaws.com'], 'only the schedule may invoke it');
  }
});

test('T-WINF-10 T-WINF-11 housekeeping grants: ListUsers and two admin calls on this pool, that one delete function, that one parameter, the tables', () => {
  for (const stage of STAGES) {
    const { stack, resources } = synth(stage);
    const names = stageValueNames(resources, stage);
    const { roleId } = housekeeping(resources, stage);
    const role = resources[roleId];
    assert.deepEqual(role.Properties.AssumeRolePolicyDocument.Statement, [
      { Action: 'sts:AssumeRole', Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' } },
    ]);
    assert.equal(role.Properties.ManagedPolicyArns, undefined, 'no managed policies');

    const sessions = stack.resolve(stack.sessionsTable.tableArn)['Fn::GetAtt'][0];
    const accounts = stack.resolve(stack.accountsTable.tableArn)['Fn::GetAtt'][0];
    assert.deepEqual(
      grants(resources, roleId, names).filter((g) => !/^logs:(CreateLogStream|PutLogEvents) /.test(g)),
      [
        ...cross(
          ['cognito-idp:AdminDeleteUser', 'cognito-idp:AdminUserGlobalSignOut', 'cognito-idp:ListUsers'],
          ['arn:aws:cognito-idp:us-east-1:111111111111:userpool/{{user-pool-id}}'],
        ),
        // D-104: one function, one grant. The data service's delete function (api-delete).
        `lambda:InvokeFunction arn:aws:lambda:us-east-1:111111111111:function:smart-finances-${stage}-api-delete`,
        `ssm:GetParameter arn:aws:ssm:us-east-1:111111111111:parameter/smart-finances/${stage}/delete-function-name`,
        // Deleting accounts rows are found by a scan of that one table; sessions by the bySub index.
        `dynamodb:DeleteItem {{${accounts}.Arn}}`,
        `dynamodb:Scan {{${accounts}.Arn}}`,
        `dynamodb:DeleteItem {{${sessions}.Arn}}`,
        `dynamodb:Query {{${sessions}.Arn}}/index/bySub`,
      ].sort(),
      `${stage}: housekeeping grants exactly as listed`,
    );
    // Its log writes go to its own group only.
    for (const g of grants(resources, roleId, names).filter((g) => /^logs:/.test(g))) {
      assert.match(g, /^logs:(CreateLogStream|PutLogEvents) \{\{HousekeepingLogs[0-9A-F]+\.Arn\}\}$/, g);
    }
    // The compute role gains nothing from this task: ListUsers and invoke stay with housekeeping.
    const computeId = stack.resolve(stack.computeRole.roleArn)['Fn::GetAtt'][0];
    assert.ok(!grants(resources, computeId, names).some((g) => /ListUsers|lambda:/.test(g)));
  }
});

test('T-WINF-15 RUM app monitor for the branch domain: errors and performance, no cookies, the guest identity pool and role', () => {
  for (const stage of STAGES) {
    const { stack, resources } = synth(stage);
    const names = stageValueNames(resources, stage);

    const monitors = ofType(resources, 'AWS::RUM::AppMonitor');
    assert.equal(monitors.length, 1, `${stage}: one RUM app monitor`);
    const [[monitorId, monitor]] = monitors;
    const p = monitor.Properties;
    assert.equal(p.Name, `smart-finances-${stage}`);
    assert.equal(flat(p.Domain, names), `${BRANCH[stage]}.{{amplify-app-id}}.amplifyapp.com`);
    assert.equal(p.DomainList, undefined, 'the branch domain only');
    assert.ok([undefined, false].includes(p.CwLogEnabled), 'no copy of the events in CloudWatch Logs');
    assert.equal(p.CustomEvents, undefined);

    const c = p.AppMonitorConfiguration;
    assert.equal(c.AllowCookies, false, 'no cookies (D-135)');
    assert.deepEqual([...c.Telemetries].sort(), ['errors', 'performance']);
    assert.equal(c.EnableXRay, false);
    assert.equal(c.SessionSampleRate, 1);
    assert.equal(c.MetricDestinations, undefined);

    const pools = ofType(resources, 'AWS::Cognito::IdentityPool');
    assert.equal(pools.length, 1, `${stage}: one identity pool`);
    const [[poolId, pool]] = pools;
    assert.deepEqual(c.IdentityPoolId, { Ref: poolId });
    assert.equal(pool.Properties.AllowUnauthenticatedIdentities, true, 'guests only');
    for (const key of ['CognitoIdentityProviders', 'SupportedLoginProviders', 'OpenIdConnectProviderARNs', 'SamlProviderARNs', 'DeveloperProviderName', 'CognitoEvents', 'CognitoStreams', 'PushSync']) {
      assert.equal(pool.Properties[key], undefined, `no ${key}: nobody signs in to this pool`);
    }
    assert.ok([undefined, false].includes(pool.Properties.AllowClassicFlow), 'enhanced flow only: the content policy allows cognito-identity, not sts');

    const guestRoleId = stack.resolve(stack.rumGuestRole.roleArn)['Fn::GetAtt'][0];
    assert.deepEqual(c.GuestRoleArn, { 'Fn::GetAtt': [guestRoleId, 'Arn'] });

    const attachments = ofType(resources, 'AWS::Cognito::IdentityPoolRoleAttachment');
    assert.equal(attachments.length, 1);
    assert.deepEqual(attachments[0][1].Properties, {
      IdentityPoolId: { Ref: poolId },
      Roles: { unauthenticated: { 'Fn::GetAtt': [guestRoleId, 'Arn'] } },
    });

    // The published ids: the monitor's id, the pool's id and the guest role's ARN.
    const params = Object.fromEntries(ofType(resources, 'AWS::SSM::Parameter').map(([, r]) => [r.Properties.Name, r.Properties.Value]));
    const base = `/smart-finances/${stage}/`;
    assert.deepEqual(Object.keys(params).sort(), [
      `${base}housekeeping-hmac-secret-arn`,
      `${base}rum-app-monitor-id`,
      `${base}rum-guest-role-arn`,
      `${base}rum-identity-pool-id`,
    ]);
    assert.deepEqual(params[`${base}rum-app-monitor-id`], { 'Fn::GetAtt': [monitorId, 'Id'] });
    assert.deepEqual(params[`${base}rum-identity-pool-id`], { Ref: poolId });
    assert.deepEqual(params[`${base}rum-guest-role-arn`], { 'Fn::GetAtt': [guestRoleId, 'Arn'] });
  }
});

test('T-WINF-15 the guest role: assumed only by guests of this identity pool; may only put RUM events to this monitor', () => {
  for (const stage of STAGES) {
    const { stack, resources } = synth(stage);
    const names = stageValueNames(resources, stage);
    const guestRoleId = stack.resolve(stack.rumGuestRole.roleArn)['Fn::GetAtt'][0];
    const [[poolId]] = ofType(resources, 'AWS::Cognito::IdentityPool');

    const role = resources[guestRoleId];
    assert.equal(role.Type, 'AWS::IAM::Role');
    assert.deepEqual(role.Properties.AssumeRolePolicyDocument.Statement, [
      {
        Action: 'sts:AssumeRoleWithWebIdentity',
        Effect: 'Allow',
        Principal: { Federated: 'cognito-identity.amazonaws.com' },
        Condition: {
          StringEquals: { 'cognito-identity.amazonaws.com:aud': { Ref: poolId } },
          'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'unauthenticated' },
        },
      },
    ]);
    assert.equal(role.Properties.ManagedPolicyArns, undefined, 'no managed policies');
    assert.equal(role.Properties.Policies, undefined, 'no inline policies on the role itself');
    assert.deepEqual(grants(resources, guestRoleId, names), [`rum:PutRumEvents arn:aws:rum:us-east-1:111111111111:appmonitor/smart-finances-${stage}`]);

    // No other role in the stack may put RUM events, and no one gets rum:* or a wildcard on RUM.
    for (const [, policy] of ofType(resources, 'AWS::IAM::Policy')) {
      const roles = (policy.Properties.Roles as any[]).map((r) => r.Ref);
      for (const s of policy.Properties.PolicyDocument.Statement) {
        const actions = [s.Action].flat() as string[];
        assert.ok(!actions.some((a) => a === '*' || a.startsWith('rum:*')), 'no wildcard RUM grant');
        if (actions.some((a) => a.startsWith('rum:'))) assert.deepEqual(roles, [guestRoleId], 'only the guest role has RUM rights');
      }
    }
  }
});
