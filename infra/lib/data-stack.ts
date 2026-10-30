import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface DataStackProps extends cdk.StackProps {
  stage: string;
  webOrigins: string[];
}

/**
 * Per-stage stores (ADR 0004): one table, one private upload bucket, one user pool. The API
 * stack reads their names and ids from SSM, never from CloudFormation exports, so it can stop
 * using a value without blocking a deploy of this stack.
 */
export class DataStack extends cdk.Stack {
  readonly table: dynamodb.Table;
  readonly uploads: s3.Bucket;
  readonly userPool: cognito.UserPool;
  readonly webClient: cognito.UserPoolClient;

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

    // The sign-in sub is the person key of every stored item, so the pool is kept in every stage:
    // a new pool would orphan all data (RK-10). The owner creates each user by hand.
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      standardAttributes: { email: { required: true, mutable: true } },
      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      featurePlan: cognito.FeaturePlan.LITE,
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { sms: false, otp: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Public client for the web app: no secret, SRP sign-in and refresh only, no hosted UI or OAuth.
    this.webClient = this.userPool.addClient('WebClient', {
      generateSecret: false,
      authFlows: { userSrp: true },
      disableOAuth: true,
      preventUserExistenceErrors: true,
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
    new ssm.StringParameter(this, 'UserPoolIdParam', {
      parameterName: `${prefix}/user-pool-id`,
      stringValue: this.userPool.userPoolId,
    });
    new ssm.StringParameter(this, 'UserPoolClientIdParam', {
      parameterName: `${prefix}/user-pool-client-id`,
      stringValue: this.webClient.userPoolClientId,
    });
  }
}
