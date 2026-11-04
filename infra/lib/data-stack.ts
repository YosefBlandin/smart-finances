import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { makeFunction } from './function';

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
  readonly stage: string;
  readonly table: dynamodb.Table;
  readonly uploads: s3.Bucket;
  readonly userPool: cognito.UserPool;
  readonly webClient: cognito.UserPoolClient;
  readonly webServerClient: cognito.UserPoolClient;
  readonly webServerClientSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    this.stage = props.stage;

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
    // a new pool would orphan all data (RK-10, RK-5). Sign-up, policy and client changes below
    // update it in place; the logical id is pinned by a synth test. People sign up through the
    // web server (D-61); who may sign up is decided by the pre-sign-up trigger (D-98, D-109).
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      standardAttributes: { email: { required: true, mutable: true } },
      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // Lite plan, no threat protection (D-117): the web server refuses breached passwords.
      featurePlan: cognito.FeaturePlan.LITE,
      // Length 12 to 128, any characters, no composition rules (Contracts, D-75); the web server
      // enforces the 128 upper bound.
      passwordPolicy: {
        minLength: 12,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { sms: false, otp: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const prefix = `/smart-finances/${props.stage}`;

    // Who may sign up (D-98, D-109, D-118): the web-server client only, while signup-open is
    // "true", and no disposable domain. The trigger reads web-client-id and signup-open at run
    // time; its environment holds no pool or client id and its grant names the two parameters
    // as plain ARNs, so the pool, the client and the trigger do not depend on each other.
    const preSignUp = makeFunction(this, {
      name: 'pre-sign-up',
      entry: 'infra/lambda/pre-sign-up.mjs',
      memoryMb: 256,
      timeoutSeconds: 5,
    });
    preSignUp.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameters'],
        resources: ['web-client-id', 'signup-open'].map((name) =>
          this.formatArn({ service: 'ssm', resource: 'parameter', resourceName: `${prefix.slice(1)}/${name}` }),
        ),
      }),
    );
    this.userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, preSignUp);

    // Public client for the web app: no secret, SRP sign-in and refresh only, no hosted UI or OAuth.
    this.webClient = this.userPool.addClient('WebClient', {
      generateSecret: false,
      authFlows: { userSrp: true },
      disableOAuth: true,
      preventUserExistenceErrors: true,
    });

    // Confidential client for the web server (D-73): a secret, the password flow and refresh, no
    // OAuth, no context data (D-117). The public client above goes once this works on qa (D-98).
    this.webServerClient = this.userPool.addClient('WebServerClient', {
      generateSecret: true,
      authFlows: { userPassword: true },
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.hours(12),
      authSessionValidity: cdk.Duration.minutes(15),
      disableOAuth: true,
      preventUserExistenceErrors: true,
    });

    // The client secret is copied into Secrets Manager, read at run time by the compute role; only
    // its ARN is published. userPoolClientSecret describes the client in a custom resource that
    // hides the response from its logs (unless @aws-cdk/cognito:logUserPoolClientSecretValue is on).
    this.webServerClientSecret = new secretsmanager.Secret(this, 'WebServerClientSecret', {
      description: `Client secret of the ${props.stage} web-server sign-in client`,
      secretStringValue: this.webServerClient.userPoolClientSecret,
    });

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
    new ssm.StringParameter(this, 'WebClientIdParam', {
      parameterName: `${prefix}/web-client-id`,
      stringValue: this.webServerClient.userPoolClientId,
    });
    new ssm.StringParameter(this, 'WebClientSecretArnParam', {
      parameterName: `${prefix}/web-client-secret-arn`,
      stringValue: this.webServerClientSecret.secretArn,
    });
  }
}
