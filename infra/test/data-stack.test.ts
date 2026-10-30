import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { DataStack } from '../lib/data-stack';

const env = { account: '111111111111', region: 'us-east-1' };
const STAGES = ['dev', 'qa', 'staging', 'prod'];
const retained = (stage: string) => stage === 'staging' || stage === 'prod';

function synth(stage: string, webOrigins: string[] = ['http://localhost:3000']) {
  const app = new cdk.App();
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
    assert.equal(props.StreamSpecification, undefined, 'no stream yet');
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

test('T-INF-3 bucket: private, SSE-S3, TLS only, no versioning, EventBridge on, CORS POST from webOrigins only', () => {
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
    assert.deepEqual(props.CorsConfiguration, {
      CorsRules: [{ AllowedMethods: ['POST'], AllowedOrigins: ['http://localhost:3000'] }],
    });
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
  assert.equal(noOrigins.Properties.CorsConfiguration, undefined, 'no CORS rule at all when webOrigins is empty');
});

test('T-INF-4 pool: self sign-up off, MFA required with TOTP only, retained in every stage; client: no secret, SRP and refresh only', () => {
  for (const stage of STAGES) {
    const template = synth(stage);
    const pool = only(template, 'AWS::Cognito::UserPool');
    const props = pool.Properties;
    assert.deepEqual(props.AdminCreateUserConfig, { AllowAdminCreateUserOnly: true }, 'no self sign-up');
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

    const client = only(template, 'AWS::Cognito::UserPoolClient').Properties;
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
      Value: { Ref: 'UserPoolWebClient4C9370B0' },
    });
  }
});

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
