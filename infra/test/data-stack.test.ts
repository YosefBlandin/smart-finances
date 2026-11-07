import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataStack } from '../lib/data-stack';

const env = { account: '111111111111', region: 'us-east-1' };
const STAGES = ['dev', 'qa', 'staging', 'prod'];
const retained = (stage: string) => stage === 'staging' || stage === 'prod';

function synth(stage: string, webOrigins: string[] = ['http://localhost:3000'], context?: Record<string, unknown>) {
  const app = new cdk.App({ context });
  const stack = new DataStack(app, `smart-finances-data-${stage}`, { env, stage, webOrigins });
  return Template.fromStack(stack);
}

function only(template: Template, type: string) {
  const found = template.findResources(type);
  assert.equal(Object.keys(found).length, 1, `one ${type}`);
  return Object.values(found)[0] as { Properties: Record<string, unknown>; DeletionPolicy?: string; UpdateReplacePolicy?: string };
}

test('T-INF-2 table: pk and sk strings, on-demand, PITR on, AWS-owned key, retained only in staging and prod', () => {
  for (const stage of STAGES) {
    const template = synth(stage);
    const table = only(template, 'AWS::DynamoDB::Table');
    const props = table.Properties;
    assert.deepEqual(props.KeySchema, [
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ]);
    assert.deepEqual(props.AttributeDefinitions, [
      { AttributeName: 'pk', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' },
    ]);
    assert.equal(props.BillingMode, 'PAY_PER_REQUEST');
    assert.deepEqual(props.PointInTimeRecoverySpecification, { PointInTimeRecoveryEnabled: true });
    // SSEEnabled false is DynamoDB's AWS-owned key; true would mean a KMS key.
    assert.deepEqual(props.SSESpecification, { SSEEnabled: false }, `${stage} table uses the AWS-owned key`);
    assert.deepEqual(props.StreamSpecification, { StreamViewType: 'KEYS_ONLY' }, 'keys-only stream (T-INF-10)');
    assert.equal(props.GlobalSecondaryIndexes, undefined, 'no secondary index');
    assert.equal(props.TableName, undefined, 'no physical name');
    if (retained(stage)) {
      assert.equal(table.DeletionPolicy, 'Retain');
      assert.equal(table.UpdateReplacePolicy, 'Retain');
      assert.equal(props.DeletionProtectionEnabled, true);
    } else {
      assert.equal(table.DeletionPolicy, 'Delete');
      assert.notEqual(props.DeletionProtectionEnabled, true);
    }
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: `/smart-finances/${stage}/table-name`,
      Type: 'String',
      Value: { Ref: Match.stringLikeRegexp('^Table') },
    });
  }
});

test('T-INF-3 bucket: private, SSE-S3, TLS only, no versioning, EventBridge on, no browser rule from the data stack (D-88)', () => {
  for (const stage of STAGES) {
    const template = synth(stage);
    const bucket = only(template, 'AWS::S3::Bucket');
    const props = bucket.Properties;
    assert.deepEqual(props.PublicAccessBlockConfiguration, {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    assert.deepEqual(props.BucketEncryption, {
      ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }],
    });
    assert.equal(props.VersioningConfiguration, undefined, 'no versioning');
    assert.equal(props.BucketName, undefined, 'no physical name');
    // The web stack sets the browser rule with the Amplify branch address (D-88), even when web origins are given.
    assert.equal(props.CorsConfiguration, undefined, `${stage}: no CORS rule from the data stack`);
    template.hasResourceProperties('Custom::S3BucketNotifications', {
      NotificationConfiguration: { EventBridgeConfiguration: {} },
    });
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Action: 's3:*',
            Principal: { AWS: '*' },
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    });
    const autoDelete = Object.keys(template.findResources('Custom::S3AutoDeleteObjects')).length;
    if (retained(stage)) {
      assert.equal(bucket.DeletionPolicy, 'Retain');
      assert.equal(bucket.UpdateReplacePolicy, 'Retain');
      assert.equal(autoDelete, 0, 'no auto-delete in staging and prod');
    } else {
      assert.equal(bucket.DeletionPolicy, 'Delete');
      assert.equal(autoDelete, 1, 'auto-delete in dev and qa');
    }
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: `/smart-finances/${stage}/bucket-name`,
      Type: 'String',
      Value: { Ref: Match.stringLikeRegexp('^Uploads') },
    });
  }

  const noOrigins = only(synth('prod', []), 'AWS::S3::Bucket');
  assert.equal(noOrigins.Properties.CorsConfiguration, undefined, 'no CORS rule when webOrigins is empty either');
});

test('T-INF-4 pool: MFA required with TOTP only, retained in every stage; public client: no secret, SRP and refresh only', () => {
  for (const stage of STAGES) {
    const template = synth(stage);
    const pool = only(template, 'AWS::Cognito::UserPool');
    const props = pool.Properties;
    // Self sign-up is on since SF-121 (T-WINF-1).
    assert.equal(props.MfaConfiguration, 'ON');
    assert.deepEqual(props.EnabledMfas, ['SOFTWARE_TOKEN_MFA']);
    assert.deepEqual(props.UsernameAttributes, ['email']);
    assert.deepEqual(props.UsernameConfiguration, { CaseSensitive: false });
    assert.deepEqual(props.AutoVerifiedAttributes, ['email']);
    assert.deepEqual(props.AccountRecoverySetting, { RecoveryMechanisms: [{ Name: 'verified_email', Priority: 1 }] });
    assert.equal(props.UserPoolTier, 'LITE');
    assert.equal(props.UserPoolName, undefined, 'no physical name');
    assert.equal(pool.DeletionPolicy, 'Retain', `${stage} pool is retained`);
    assert.equal(pool.UpdateReplacePolicy, 'Retain');

    const client = (template.toJSON().Resources as Record<string, { Properties: Record<string, unknown> }>)[PUBLIC_CLIENT_ID].Properties;
    assert.equal(client.GenerateSecret, false);
    assert.deepEqual([...(client.ExplicitAuthFlows as string[])].sort(), ['ALLOW_REFRESH_TOKEN_AUTH', 'ALLOW_USER_SRP_AUTH']);
    assert.equal(client.AllowedOAuthFlows, undefined, 'no OAuth flows');
    assert.notEqual(client.AllowedOAuthFlowsUserPoolClient, true);

    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: `/smart-finances/${stage}/user-pool-id`,
      Value: { Ref: PINNED.pool.logicalId },
    });
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: `/smart-finances/${stage}/user-pool-client-id`,
      Value: { Ref: PUBLIC_CLIENT_ID },
    });
  }
});

// The public SRP client of the old app; it stays until the web server signs in on qa (D-73, D-98).
const PUBLIC_CLIENT_ID = 'UserPoolWebClient4C9370B0';

// Changing any of these replaces the table or the pool, and a new pool means new sign-in subs
// that no longer match stored items (RK-10). Change them only with a migration plan.
const PINNED = {
  table: {
    logicalId: 'TableCD117FA1',
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' },
    ],
  },
  pool: {
    logicalId: 'UserPool6BA7E5F2',
    UsernameAttributes: ['email'],
    UsernameConfiguration: { CaseSensitive: false },
    AliasAttributes: undefined,
    Schema: [{ Name: 'email', Mutable: true, Required: true }],
  },
};

test('T-INF-5 logical ids, key schema and sign-in attributes of the table and pool equal the pinned values', () => {
  for (const stage of STAGES) {
    const resources = synth(stage).toJSON().Resources as Record<string, { Type: string; Properties: Record<string, unknown> }>;
    const table = resources[PINNED.table.logicalId];
    assert.equal(table?.Type, 'AWS::DynamoDB::Table', `${stage} table keeps logical id ${PINNED.table.logicalId}`);
    assert.deepEqual(table.Properties.KeySchema, PINNED.table.KeySchema);
    assert.deepEqual(table.Properties.AttributeDefinitions, PINNED.table.AttributeDefinitions);
    assert.equal(table.Properties.TableName, undefined);

    const pool = resources[PINNED.pool.logicalId];
    assert.equal(pool?.Type, 'AWS::Cognito::UserPool', `${stage} pool keeps logical id ${PINNED.pool.logicalId}`);
    assert.deepEqual(pool.Properties.UsernameAttributes, PINNED.pool.UsernameAttributes);
    assert.deepEqual(pool.Properties.UsernameConfiguration, PINNED.pool.UsernameConfiguration);
    assert.equal(pool.Properties.AliasAttributes, PINNED.pool.AliasAttributes);
    assert.deepEqual(pool.Properties.Schema, PINNED.pool.Schema);
    assert.equal(pool.Properties.UserPoolName, undefined);
  }
});

type Resources = Record<string, { Type: string; Properties: Record<string, any>; DeletionPolicy?: string }>;

test('T-WINF-1 pool opens sign-up in place: self sign-up on, Lite plan, password minimum 12 with no classes, TOTP required; pool and public client keep their logical ids', () => {
  for (const stage of STAGES) {
    const resources = synth(stage).toJSON().Resources as Resources;
    const pools = Object.entries(resources).filter(([, r]) => r.Type === 'AWS::Cognito::UserPool');
    assert.deepEqual(pools.map(([id]) => id), [PINNED.pool.logicalId], `${stage} has the one pool, same logical id (no replacement)`);
    const pool = resources[PINNED.pool.logicalId].Properties;
    assert.deepEqual(pool.AdminCreateUserConfig, { AllowAdminCreateUserOnly: false }, 'self sign-up on');
    assert.equal(pool.UserPoolTier, 'LITE', 'Lite plan, no threat protection (D-117)');
    assert.equal(pool.UserPoolAddOns, undefined, 'no advanced security add-on');
    assert.deepEqual(
      {
        MinimumLength: pool.Policies?.PasswordPolicy?.MinimumLength,
        RequireLowercase: pool.Policies?.PasswordPolicy?.RequireLowercase,
        RequireUppercase: pool.Policies?.PasswordPolicy?.RequireUppercase,
        RequireNumbers: pool.Policies?.PasswordPolicy?.RequireNumbers,
        RequireSymbols: pool.Policies?.PasswordPolicy?.RequireSymbols,
      },
      { MinimumLength: 12, RequireLowercase: false, RequireUppercase: false, RequireNumbers: false, RequireSymbols: false },
      'password minimum 12, no character classes (Contracts "Password and code rules")',
    );
    assert.equal(pool.MfaConfiguration, 'ON', 'TOTP required unchanged');
    assert.deepEqual(pool.EnabledMfas, ['SOFTWARE_TOKEN_MFA']);
    assert.deepEqual(pool.AccountRecoverySetting, { RecoveryMechanisms: [{ Name: 'verified_email', Priority: 1 }] });

    const publicClient = resources[PUBLIC_CLIENT_ID];
    assert.equal(publicClient?.Type, 'AWS::Cognito::UserPoolClient', `${stage} public client keeps logical id ${PUBLIC_CLIENT_ID}`);
    assert.equal(publicClient.Properties.GenerateSecret, false);
    assert.deepEqual([...publicClient.Properties.ExplicitAuthFlows].sort(), ['ALLOW_REFRESH_TOKEN_AUTH', 'ALLOW_USER_SRP_AUTH']);
    assert.deepEqual(publicClient.Properties.UserPoolId, { Ref: PINNED.pool.logicalId });
  }
});

// Collects every { 'Fn::GetAtt': [logicalId, ...] } and { Ref: logicalId } target inside a value.
function refsIn(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => refsIn(v, into));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'Ref' && typeof v === 'string') into.add(v);
      else if (k === 'Fn::GetAtt' && Array.isArray(v)) into.add(String(v[0]));
      else refsIn(v, into);
    }
  }
  return into;
}

test('T-WINF-2 web-server client: secret, password flow and refresh, 60-minute access, 12-hour refresh, 15-minute session, no OAuth; its secret lives only in a Secrets Manager secret, and no output or parameter holds it', () => {
  // Synth with the deploy context of cdk.json, so a feature flag that logs the secret would show.
  const cdkJson = JSON.parse(readFileSync(join(__dirname, '..', 'cdk.json'), 'utf8')) as { context: Record<string, unknown> };
  for (const stage of STAGES) {
    const template = synth(stage, ['http://localhost:3000'], cdkJson.context);
    const json = template.toJSON() as { Resources: Resources; Outputs?: Record<string, unknown>; Parameters?: Record<string, unknown> };
    const resources = json.Resources;

    const clients = Object.entries(resources).filter(([, r]) => r.Type === 'AWS::Cognito::UserPoolClient');
    assert.equal(clients.length, 2, `${stage}: the public client and the web-server client`);
    const confidential = clients.filter(([, r]) => r.Properties.GenerateSecret === true);
    assert.equal(confidential.length, 1, 'one client with a secret');
    const [clientId, client] = confidential[0];
    assert.notEqual(clientId, PUBLIC_CLIENT_ID);
    const p = client.Properties;
    assert.deepEqual(p.UserPoolId, { Ref: PINNED.pool.logicalId });
    assert.deepEqual([...p.ExplicitAuthFlows].sort(), ['ALLOW_REFRESH_TOKEN_AUTH', 'ALLOW_USER_PASSWORD_AUTH'], 'password flow and refresh only');
    assert.equal(p.AccessTokenValidity, 60);
    assert.equal(p.RefreshTokenValidity, 12 * 60);
    assert.equal(p.TokenValidityUnits?.AccessToken, 'minutes');
    assert.equal(p.TokenValidityUnits?.RefreshToken, 'minutes');
    assert.equal(p.AuthSessionValidity, 15, 'challenge session 15 minutes');
    assert.equal(p.AllowedOAuthFlowsUserPoolClient, false, 'OAuth off');
    assert.equal(p.AllowedOAuthFlows, undefined);
    assert.equal(p.AllowedOAuthScopes, undefined);
    assert.equal(p.CallbackURLs, undefined);
    assert.equal(p.PreventUserExistenceErrors, 'ENABLED');
    assert.notEqual(p.EnablePropagateAdditionalUserContextData, true, 'no context data (D-117)');

    // The secret is read from the client by one describe call whose response data is not logged.
    const describers = Object.entries(resources).filter(([, r]) => r.Type === 'Custom::DescribeCognitoUserPoolClient');
    assert.equal(describers.length, 1, 'one describe call for the client secret');
    const [describerId, describer] = describers[0];
    const call = JSON.stringify(describer.Properties);
    assert.match(call, /describeUserPoolClient/);
    assert.match(call, /logApiResponseData\\?":false/, 'the custom resource does not log the response holding the secret');

    const secrets = Object.entries(resources).filter(([, r]) => r.Type === 'AWS::SecretsManager::Secret');
    assert.equal(secrets.length, 1, 'one Secrets Manager secret');
    const [secretId, secret] = secrets[0];
    assert.deepEqual(secret.Properties.SecretString, { 'Fn::GetAtt': [describerId, 'UserPoolClient.ClientSecret'] }, 'the secret holds the client secret');
    assert.equal(secret.Properties.GenerateSecretString, undefined);

    // Only the Secrets Manager secret may read the describe response.
    const readers = Object.entries(resources).filter(([id, r]) => id !== describerId && refsIn(r).has(describerId)).map(([id]) => id);
    assert.deepEqual(readers, [secretId], 'nothing but the secret reads the client secret');
    assert.equal(refsIn(json.Outputs ?? {}).has(describerId), false, 'no output holds the secret');
    for (const [id, param] of Object.entries(json.Parameters ?? {})) {
      assert.equal(id === 'BootstrapVersion' || !JSON.stringify(param).includes('ecret'), true, `template parameter ${id} is not a secret`);
    }

    // Published: the client id and the secret's ARN, never the value.
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: `/smart-finances/${stage}/web-client-id`,
      Type: 'String',
      Value: { Ref: clientId },
    });
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: `/smart-finances/${stage}/web-client-secret-arn`,
      Type: 'String',
      Value: { Ref: secretId },
    });
    for (const param of Object.values(resources).filter((r) => r.Type === 'AWS::SSM::Parameter')) {
      const targets = refsIn(param.Properties.Value);
      assert.equal(targets.has(describerId), false, `${param.Properties.Name} does not hold the secret`);
    }
  }
});

// Every Ref, GetAtt and DependsOn edge between resources; a path back to the start is a cycle.
function findCycle(resources: Resources & Record<string, { DependsOn?: string | string[] }>): string[] | undefined {
  const edges = new Map<string, string[]>();
  for (const [id, r] of Object.entries(resources)) {
    const deps = new Set([...refsIn(r.Properties ?? {})].filter((t) => t in resources));
    for (const d of [r.DependsOn ?? []].flat()) deps.add(d);
    edges.set(id, [...deps]);
  }
  const state = new Map<string, 'open' | 'done'>();
  const path: string[] = [];
  const visit = (id: string): string[] | undefined => {
    if (state.get(id) === 'done') return undefined;
    if (state.get(id) === 'open') return [...path.slice(path.indexOf(id)), id];
    state.set(id, 'open');
    path.push(id);
    for (const next of edges.get(id) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(id, 'done');
    return undefined;
  };
  for (const id of edges.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return undefined;
}

test('T-WINF-4 pre-sign-up trigger: wired to the pool, its environment holds no pool or client reference, it may read only web-client-id and signup-open, and the data stack has no cycle', () => {
  for (const stage of STAGES) {
    const json = synth(stage).toJSON() as { Resources: Resources };
    const resources = json.Resources;

    const fns = Object.entries(resources).filter(
      ([, r]) => r.Type === 'AWS::Lambda::Function' && r.Properties.FunctionName === `smart-finances-${stage}-pre-sign-up`,
    );
    assert.equal(fns.length, 1, `${stage}: one pre-sign-up function`);
    const [fnId, fn] = fns[0];
    assert.equal(fn.Properties.Runtime, 'nodejs22.x');

    const pool = resources[PINNED.pool.logicalId].Properties;
    assert.deepEqual(pool.LambdaConfig?.PreSignUp, { 'Fn::GetAtt': [fnId, 'Arn'] }, 'the pool calls the trigger before sign-up');

    // D-109: no pool or client id from the environment; the trigger reads its stage's parameters at run time.
    const variables = fn.Properties.Environment?.Variables ?? {};
    assert.deepEqual(variables, { STAGE: stage }, 'the environment holds the stage only');
    assert.equal(refsIn(fn.Properties.Environment ?? {}).size, 0, 'no Ref or GetAtt in the environment');

    // The function's role may read exactly the two parameters, named as strings (no Ref to the client or pool).
    const roleId = (fn.Properties.Role as { 'Fn::GetAtt': [string, string] })['Fn::GetAtt'][0];
    const policies = Object.values(resources).filter(
      (r) => r.Type === 'AWS::IAM::Policy' && (r.Properties.Roles as Array<{ Ref: string }>).some((x) => x.Ref === roleId),
    );
    const statements = policies.flatMap((p) => p.Properties.PolicyDocument.Statement as Array<Record<string, any>>);
    const ssmStatements = statements.filter((s) => [s.Action].flat().some((a: string) => a.startsWith('ssm:')));
    assert.equal(ssmStatements.length, 1, 'one SSM statement');
    const [ssmStatement] = ssmStatements;
    assert.equal(ssmStatement.Effect, 'Allow');
    assert.deepEqual([ssmStatement.Action].flat(), ['ssm:GetParameters']);
    const arns = [ssmStatement.Resource].flat().map((r) => JSON.stringify(r));
    assert.equal(arns.length, 2, 'two parameters');
    assert.ok(arns.some((a) => a.includes(`:parameter/smart-finances/${stage}/web-client-id`)), 'web-client-id');
    assert.ok(arns.some((a) => a.includes(`:parameter/smart-finances/${stage}/signup-open`)), 'signup-open');
    const arnTargets = [...refsIn(ssmStatement.Resource)].filter((t) => !t.startsWith('AWS::'));
    assert.deepEqual(arnTargets, [], 'parameter ARNs reference no resource of the stack (pseudo parameters only)');
    for (const s of statements) {
      for (const action of [s.Action].flat() as string[]) {
        assert.ok(action.startsWith('logs:') || action === 'ssm:GetParameters', `${stage}: no other right (${action})`);
      }
    }

    // Cognito may invoke the trigger, from this pool only.
    const permissions = Object.values(resources).filter(
      (r) => r.Type === 'AWS::Lambda::Permission' && JSON.stringify(r.Properties.FunctionName).includes(fnId),
    );
    assert.equal(permissions.length, 1);
    assert.equal(permissions[0].Properties.Principal, 'cognito-idp.amazonaws.com');
    assert.deepEqual(permissions[0].Properties.SourceArn, { 'Fn::GetAtt': [PINNED.pool.logicalId, 'Arn'] });

    assert.equal(findCycle(resources), undefined, `${stage}: no dependency cycle`);
  }
});

test('T-INF-10 the table stream is keys only and its ARN is published as table-stream-arn', () => {
  for (const stage of STAGES) {
    const template = synth(stage);
    const resources = template.toJSON().Resources as Record<string, { Type: string; Properties: Record<string, any> }>;
    const table = resources[PINNED.table.logicalId];
    assert.deepEqual(table.Properties.StreamSpecification, { StreamViewType: 'KEYS_ONLY' }, `${stage}: keys only`);
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: `/smart-finances/${stage}/table-stream-arn`,
      Type: 'String',
      Value: { 'Fn::GetAtt': [PINNED.table.logicalId, 'StreamArn'] },
    });
  }
});
