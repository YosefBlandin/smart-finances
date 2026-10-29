import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface DataStackProps extends cdk.StackProps {
  stage: string;
  webOrigins: string[];
}

/**
 * Per-stage stores (ADR 0004): one table, one private upload bucket. The API stack reads their
 * names from SSM, never from CloudFormation exports, so it can stop using a value without
 * blocking a deploy of this stack.
 */
export class DataStack extends cdk.Stack {
  readonly table: dynamodb.Table;
  readonly uploads: s3.Bucket;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    // Real data lives in staging and prod: keep it if the stack or resource is removed.
    const keep = props.stage === 'staging' || props.stage === 'prod';
    const removalPolicy = keep ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // One partition per person (pk = U#<sub>), typed sort keys. Keys are built only in apps/api/src/store/keys.mjs.
    this.table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // 35-day window: erased items stay restorable that long (threat model).
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      // AWS-owned key now; customer-managed keys come in Epic 6.
      encryption: dynamodb.TableEncryption.DEFAULT,
      deletionProtection: keep,
      removalPolicy,
    });

    // Raw uploads at uploads/<sub>/<importId>, kept until delete-all so undo can re-run them.
    this.uploads = new s3.Bucket(this, 'Uploads', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      // Object Created events reach the parser through EventBridge.
      eventBridgeEnabled: true,
      // The browser posts the presigned form straight to S3; no rule at all until a stage has a web origin.
      cors: props.webOrigins.length
        ? [{ allowedMethods: [s3.HttpMethods.POST], allowedOrigins: props.webOrigins }]
        : undefined,
      removalPolicy,
      autoDeleteObjects: !keep,
    });

    const prefix = `/smart-finances/${props.stage}`;
    new ssm.StringParameter(this, 'TableNameParam', {
      parameterName: `${prefix}/table-name`,
      stringValue: this.table.tableName,
    });
    new ssm.StringParameter(this, 'BucketNameParam', {
      parameterName: `${prefix}/bucket-name`,
      stringValue: this.uploads.bucketName,
    });
  }
}
