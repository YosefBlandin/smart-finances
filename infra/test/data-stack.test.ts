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
