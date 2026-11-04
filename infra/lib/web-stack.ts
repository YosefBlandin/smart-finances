import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rum from 'aws-cdk-lib/aws-rum';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { makeFunction } from './function';
import { readStageValues } from './stage-values';

/** The Amplify branch each stage deploys (D-102); dev has no web stack. */
const BRANCHES: Record<string, string> = { qa: 'qa', staging: 'staging', prod: 'main' };

/** Stage values this stack reads at deploy time (Contracts "Stage parameters"). */
const STAGE_VALUES = ['amplify-app-id', 'api-url', 'bucket-name', 'support-address', 'user-pool-id', 'web-client-id', 'web-client-secret-arn'] as const;

export interface WebStackProps extends cdk.StackProps {
  stage: string;
  /**
   * The stage's extra browser origins for the upload bucket rule (D-88). Defaults to this stage's
   * entry in the webOrigins context map in cdk.json, the list the data stack used to set.
   */
  webOrigins?: string[];
}

/**
 * The web server's side of one stage (D-102): the console-created Amplify app is adopted by the
 * amplify-app-id stage parameter, never created here. This stack owns the sessions and accounts
 * tables (D-72, D-87), the counter-key HMAC secret (D-115), the Amplify service role (log writes
 * on the app's existing log group, D-112) and the compute role the web server runs as, and sets
 * the app's platform and roles, the branch's auto-build, compute role and variables through custom
 * resources that may pass only those two roles and clear them on delete (D-93, D-110, D-111), and
 * puts the upload bucket's browser rule with the branch address (D-88). It also runs the hourly
 * housekeeping function (D-104, D-106, D-107) and the CloudWatch RUM app monitor with its guest
 * identity pool (D-135).
 * Values from the data stack and from people are read from SSM at deploy time (D-33), so synth
 * needs no stage values and there are no CloudFormation exports; delete-function-name alone is
 * read by housekeeping at run time, since it may not exist yet.
 */
export class WebStack extends cdk.Stack {
  readonly stage: string;
  /** Stage values read at deploy time. */
  readonly values: {
    amplifyAppId: string;
    apiUrl: string;
    bucketName: string;
    supportAddress: string;
    userPoolId: string;
    webClientId: string;
    webClientSecretArn: string;
  };
  /** The Amplify branch this stage deploys: qa, staging or main. */
  readonly branchName: string;
  /** The branch address, https://<branch>.<app id>.amplifyapp.com. */
  readonly webOrigin: string;
  readonly sessionsTable: dynamodb.Table;
  readonly accountsTable: dynamodb.Table;
  readonly hmacSecret: secretsmanager.Secret;
  /** The Amplify app's existing log group, /aws/amplify/<app id> (D-112). */
  readonly amplifyLogGroupName: string;
  readonly serviceRole: iam.Role;
  readonly computeRole: iam.Role;
  /** The role RUM's guest identities get: it may only put RUM events to this stage's monitor (D-135). */
  readonly rumGuestRole: iam.Role;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);
    this.stage = props.stage;
    const branchName = BRANCHES[props.stage];
    if (!branchName) throw new Error(`WebStack: no Amplify branch for stage ${props.stage}`);
    this.branchName = branchName;

    // Real people's consent lives in staging and prod: keep it if the stack goes (D-111). The web
    // stack is destroyed only on qa.
    const keep = props.stage === 'staging' || props.stage === 'prod';

    // One reader per stack (its construct id is fixed): every stage value goes in this one call.
    const values = readStageValues(this, props.stage, STAGE_VALUES);
    this.values = {
      amplifyAppId: values['amplify-app-id'],
      apiUrl: values['api-url'],
      bucketName: values['bucket-name'],
      supportAddress: values['support-address'],
      userPoolId: values['user-pool-id'],
      webClientId: values['web-client-id'],
      webClientSecretArn: values['web-client-secret-arn'],
    };
    this.webOrigin = `https://${branchName}.${this.values.amplifyAppId}.amplifyapp.com`;

    // Sessions, pre-auth state, proof-of-work answers and window counters (Contracts "Sessions
    // table"). Keys are SHA-256 or HMAC values, never a cookie id. Every read checks expires_at
    // itself; the TTL only cleans up. bySub finds every session of a person to remove them, so it
    // carries keys only: no token is copied into the index.
    this.sessionsTable = new dynamodb.Table(this, 'Sessions', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expires_at',
      encryption: dynamodb.TableEncryption.DEFAULT,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    this.sessionsTable.addGlobalSecondaryIndex({
      indexName: 'bySub',
      partitionKey: { name: 'sub', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    // One row per person, pk ACCT#<sub>: consent, status, per-person caps (D-87, D-104, D-114). No TTL.
    this.accountsTable = new dynamodb.Table(this, 'Accounts', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.DEFAULT,
      pointInTimeRecoverySpecification: keep ? { pointInTimeRecoveryEnabled: true } : undefined,
      deletionProtection: keep ? true : undefined,
      removalPolicy: keep ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Key for the counter keys (an HMAC of the email or address prefix, D-115). Generated by
    // Secrets Manager; only its ARN is published.
    this.hmacSecret = new secretsmanager.Secret(this, 'HmacSecret', {
      description: `HMAC key for the ${props.stage} web server's counter keys`,
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
    });
    new ssm.StringParameter(this, 'HmacSecretArnParam', {
      parameterName: `/smart-finances/${props.stage}/housekeeping-hmac-secret-arn`,
      stringValue: this.hmacSecret.secretArn,
    });

    // The console created the app's log group; reference it by name and set one-month retention
    // through the shared AwsCustomResource provider (D-112). Delete leaves it as it is.
    this.amplifyLogGroupName = `/aws/amplify/${this.values.amplifyAppId}`;
    const logGroupArn = this.formatArn({
      service: 'logs',
      resource: 'log-group',
      resourceName: this.amplifyLogGroupName,
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    });
    const putRetention: cr.AwsSdkCall = {
      service: 'CloudWatchLogs',
      action: 'putRetentionPolicy',
      parameters: { logGroupName: this.amplifyLogGroupName, retentionInDays: 30 },
      physicalResourceId: cr.PhysicalResourceId.of(`retention${this.amplifyLogGroupName}`),
    };
    // No role or log group of its own: the provider function is a singleton that readStageValues
    // already created with its own scoped role, and this policy attaches to that role.
    new cr.AwsCustomResource(this, 'AmplifyLogRetention', {
      onCreate: putRetention,
      onUpdate: putRetention,
      installLatestAwsSdk: false,
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: [logGroupArn, `${logGroupArn}:*`] }),
    });

    // Amplify's service role: writes the web server's logs into that one group.
    this.serviceRole = new iam.Role(this, 'AmplifyServiceRole', {
      assumedBy: new iam.ServicePrincipal('amplify.amazonaws.com'),
      description: `Amplify service role for smart-finances ${props.stage}`,
    });
    this.serviceRole.addToPolicy(
      new iam.PolicyStatement({ actions: ['logs:CreateLogStream', 'logs:PutLogEvents'], resources: [`${logGroupArn}:*`] }),
    );

    // The web server runs as this role (D-73, D-92, D-104): it reads the client and HMAC secrets
    // and the stage parameters at run time, reads and writes both tables (no scan), and may get,
    // sign out everywhere and delete users of this stage's pool only.
    this.computeRole = new iam.Role(this, 'AmplifyComputeRole', {
      assumedBy: new iam.ServicePrincipal('amplify.amazonaws.com'),
      description: `Amplify compute role for the smart-finances ${props.stage} web server`,
    });
    this.computeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [this.values.webClientSecretArn, this.hmacSecret.secretArn],
      }),
    );
    this.computeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          this.formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: `smart-finances/${props.stage}/*`,
            arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
          }),
        ],
      }),
    );
    this.computeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'dynamodb:BatchGetItem',
          'dynamodb:BatchWriteItem',
          'dynamodb:ConditionCheckItem',
          'dynamodb:DeleteItem',
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:Query',
          'dynamodb:UpdateItem',
        ],
        resources: [this.sessionsTable.tableArn, `${this.sessionsTable.tableArn}/index/*`, this.accountsTable.tableArn],
      }),
    );
    this.computeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminGetUser', 'cognito-idp:AdminDeleteUser', 'cognito-idp:AdminUserGlobalSignOut'],
        resources: [
          this.formatArn({
            service: 'cognito-idp',
            resource: 'userpool',
            resourceName: this.values.userPoolId,
            arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
          }),
        ],
      }),
    );

    this.adoptAmplifyApp(branchName);

    const contextOrigins = (this.node.tryGetContext('webOrigins') ?? {}) as Record<string, string[]>;
    this.setUploadBucketRule(props.webOrigins ?? contextOrigins[props.stage] ?? []);

    this.addHousekeeping();

    this.rumGuestRole = this.addRum(branchName);
  }

  /**
   * D-135: browser monitoring with CloudWatch RUM. One app monitor for the branch domain records
   * JavaScript errors and page loads with web vitals, sets no cookies and keeps no copy in
   * CloudWatch Logs. Browsers get credentials as guests of an identity pool nobody signs in to,
   * through the enhanced flow (cognito-identity only, which the content policy allows), and the
   * guest role may only put RUM events to this monitor. The role's grant names the monitor by its
   * fixed name, so the role does not depend on the monitor. The web client reads the three ids from
   * the published stage parameters; what it sends (no person ids, no search values) is its job.
   */
  private addRum(branchName: string): iam.Role {
    const monitorName = `smart-finances-${this.stage}`;

    const pool = new cognito.CfnIdentityPool(this, 'RumIdentityPool', {
      identityPoolName: `smart_finances_${this.stage}_rum`,
      allowUnauthenticatedIdentities: true,
      allowClassicFlow: false,
    });

    const guestRole = new iam.Role(this, 'RumGuestRole', {
      description: `RUM guest role for smart-finances ${this.stage}: put RUM events only`,
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: { 'cognito-identity.amazonaws.com:aud': pool.ref },
          'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'unauthenticated' },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
    });
    guestRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['rum:PutRumEvents'],
        resources: [this.formatArn({ service: 'rum', resource: 'appmonitor', resourceName: monitorName, arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME })],
      }),
    );

    new cognito.CfnIdentityPoolRoleAttachment(this, 'RumIdentityPoolRoles', {
      identityPoolId: pool.ref,
      roles: { unauthenticated: guestRole.roleArn },
    });

    const monitor = new rum.CfnAppMonitor(this, 'RumAppMonitor', {
      name: monitorName,
      domain: `${branchName}.${this.values.amplifyAppId}.amplifyapp.com`,
      cwLogEnabled: false,
      appMonitorConfiguration: {
        allowCookies: false,
        enableXRay: false,
        sessionSampleRate: 1,
        telemetries: ['errors', 'performance'],
        identityPoolId: pool.ref,
        guestRoleArn: guestRole.roleArn,
      },
    });

    const publish = (name: string, value: string, id: string) =>
      new ssm.StringParameter(this, id, { parameterName: `/smart-finances/${this.stage}/${name}`, stringValue: value });
    publish('rum-app-monitor-id', monitor.attrId, 'RumAppMonitorIdParam');
    publish('rum-identity-pool-id', pool.ref, 'RumIdentityPoolIdParam');
    publish('rum-guest-role-arn', guestRole.roleArn, 'RumGuestRoleArnParam');

    return guestRole;
  }

  /**
   * The hourly job (D-104, D-106, D-107; infra/lambda/housekeeping.mjs): removes unconfirmed
   * sign-ups after 24 hours, finishes stuck account deletions through the data service's delete
   * function, puts StuckDeletions, and calls the branch's /api/health once.
   *
   * delete-function-name may not exist until data PR 3, so it is read by the function at run time,
   * never by the deploy-time reader (a missing parameter would fail the deploy). Its grants: list
   * users and the two admin calls it makes on this pool, invoke that one delete function (D-104:
   * one function, one grant; the data service's smart-finances-<stage>-api-delete), read that one
   * parameter, scan and delete accounts rows, query bySub and delete session rows. A failed run is
   * not retried, so each hour calls /api/health once; its errors alarm (D-107).
   */
  private addHousekeeping() {
    const parameterName = `/smart-finances/${this.stage}/delete-function-name`;
    const fn = makeFunction(this, {
      name: 'housekeeping',
      entry: 'infra/lambda/housekeeping.mjs',
      memoryMb: 256,
      timeoutSeconds: 300,
      environment: {
        USER_POOL_ID: this.values.userPoolId,
        SESSIONS_TABLE: this.sessionsTable.tableName,
        ACCOUNTS_TABLE: this.accountsTable.tableName,
        HEALTH_URL: `${this.webOrigin}/api/health`,
        DELETE_FUNCTION_PARAMETER: parameterName,
      },
    });
    fn.configureAsyncInvoke({ retryAttempts: 0 });

    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:ListUsers', 'cognito-idp:AdminDeleteUser', 'cognito-idp:AdminUserGlobalSignOut'],
        resources: [
          this.formatArn({ service: 'cognito-idp', resource: 'userpool', resourceName: this.values.userPoolId, arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME }),
        ],
      }),
    );
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [
          this.formatArn({
            service: 'lambda',
            resource: 'function',
            resourceName: `smart-finances-${this.stage}-api-delete`,
            arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
          }),
        ],
      }),
    );
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          this.formatArn({ service: 'ssm', resource: 'parameter', resourceName: parameterName.slice(1), arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME }),
        ],
      }),
    );
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:Scan', 'dynamodb:DeleteItem'], resources: [this.accountsTable.tableArn] }));
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:DeleteItem'], resources: [this.sessionsTable.tableArn] }));
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:Query'], resources: [`${this.sessionsTable.tableArn}/index/bySub`] }));

    new events.Rule(this, 'HousekeepingSchedule', {
      description: `Hourly housekeeping of smart-finances ${this.stage}`,
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      targets: [new targets.LambdaFunction(fn)],
    });
  }

  /**
   * D-88, AC-5: the browser posts the presigned form straight to the data stack's upload bucket,
   * so the bucket named by bucket-name gets the rule the data stack used to set (POST only, no
   * other field) from the branch address and the stage's cdk.json origins. One physical id per
   * bucket, so a changed origin is an update; the rule goes with the stack, which is destroyed on
   * qa only (D-111). S3 checks s3:PutBucketCORS for both the put and the delete.
   */
  private setUploadBucketRule(extraOrigins: string[]) {
    const bucket = this.values.bucketName;
    const physicalResourceId = cr.PhysicalResourceId.of(`bucket-cors/${bucket}`);
    const putRule: cr.AwsSdkCall = {
      service: 'S3',
      action: 'putBucketCors',
      parameters: {
        Bucket: bucket,
        CORSConfiguration: { CORSRules: [{ AllowedMethods: ['POST'], AllowedOrigins: [this.webOrigin, ...extraOrigins] }] },
      },
      physicalResourceId,
    };
    new cr.AwsCustomResource(this, 'UploadBucketCors', {
      onCreate: putRule,
      onUpdate: putRule,
      onDelete: {
        service: 'S3',
        action: 'deleteBucketCors',
        parameters: { Bucket: bucket },
        physicalResourceId,
        ignoreErrorCodesMatching: 'NoSuchBucket',
      },
      installLatestAwsSdk: false,
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({ actions: ['s3:PutBucketCORS'], resources: [`arn:${this.partition}:s3:::${bucket}`] }),
      ]),
    });
  }

  /**
   * D-102, D-93, D-110, D-111: the console-created app becomes web compute with this stack's two
   * roles; its stage branch gets auto-build off and the compute role; then the branch variables
   * are merged in. The app and branch updates are SDK calls on CDK's shared provider, whose role
   * may pass only the two roles, and only to Amplify. Their answers hold the app's settings, so
   * only an id is kept and nothing is logged. Each has one physical id per app, so a stack update
   * never runs the delete (which clears the roles) against a live app.
   */
  private adoptAmplifyApp(branchName: string) {
    const appId = this.values.amplifyAppId;
    const appArn = this.formatArn({ service: 'amplify', resource: 'apps', resourceName: appId, arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME });
    const branchArn = `${appArn}/branches/${branchName}`;
    const passTo = (roles: iam.IRole[]) =>
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: roles.map((r) => r.roleArn),
        conditions: { StringEquals: { 'iam:PassedToService': 'amplify.amazonaws.com' } },
      });

    const setApp: cr.AwsSdkCall = {
      service: 'Amplify',
      action: 'updateApp',
      parameters: { appId, platform: 'WEB_COMPUTE', iamServiceRoleArn: this.serviceRole.roleArn, computeRoleArn: this.computeRole.roleArn },
      physicalResourceId: cr.PhysicalResourceId.of(`amplify-app/${appId}`),
      outputPaths: ['app.appId'],
      logging: cr.Logging.withDataHidden(),
    };
    const app = new cr.AwsCustomResource(this, 'AmplifyApp', {
      onCreate: setApp,
      onUpdate: setApp,
      // Clear only the roles this stack set; the platform stays web compute.
      onDelete: {
        service: 'Amplify',
        action: 'updateApp',
        parameters: { appId, iamServiceRoleArn: '', computeRoleArn: '' },
        ignoreErrorCodesMatching: 'NotFoundException',
        outputPaths: ['app.appId'],
        logging: cr.Logging.withDataHidden(),
      },
      installLatestAwsSdk: false,
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({ actions: ['amplify:UpdateApp'], resources: [appArn] }),
        passTo([this.serviceRole, this.computeRole]),
      ]),
    });

    const setBranch: cr.AwsSdkCall = {
      service: 'Amplify',
      action: 'updateBranch',
      parameters: { appId, branchName, enableAutoBuild: false, computeRoleArn: this.computeRole.roleArn },
      physicalResourceId: cr.PhysicalResourceId.of(`amplify-branch/${appId}/${branchName}`),
      outputPaths: ['branch.branchName'],
      logging: cr.Logging.withDataHidden(),
    };
    const branch = new cr.AwsCustomResource(this, 'AmplifyBranch', {
      onCreate: setBranch,
      onUpdate: setBranch,
      // Auto-build stays off: CI starts every job (D-93), also for a rollback.
      onDelete: {
        service: 'Amplify',
        action: 'updateBranch',
        parameters: { appId, branchName, computeRoleArn: '' },
        ignoreErrorCodesMatching: 'NotFoundException',
        outputPaths: ['branch.branchName'],
        logging: cr.Logging.withDataHidden(),
      },
      installLatestAwsSdk: false,
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({ actions: ['amplify:UpdateBranch'], resources: [branchArn] }),
        passTo([this.computeRole]),
      ]),
    });
    branch.node.addDependency(app);

    // Contracts "Web server settings": the names WebStack writes. Only ARNs of secrets, never a
    // value; COMMIT_SHA comes from amplify.yml.
    const variables: Record<string, string> = {
      STAGE: this.stage,
      AWS_REGION: this.region,
      API_URL: this.values.apiUrl,
      USER_POOL_ID: this.values.userPoolId,
      WEB_CLIENT_ID: this.values.webClientId,
      WEB_CLIENT_SECRET_ARN: this.values.webClientSecretArn,
      HMAC_SECRET_ARN: this.hmacSecret.secretArn,
      SESSIONS_TABLE: this.sessionsTable.tableName,
      ACCOUNTS_TABLE: this.accountsTable.tableName,
      // The presigned POST address the data service hands out (virtual-hosted, regional).
      UPLOAD_HOST: `${this.values.bucketName}.s3.${this.region}.amazonaws.com`,
      WEB_ORIGIN: this.webOrigin,
      SUPPORT_ADDRESS: this.values.supportAddress,
    };

    const fn = makeFunction(this, { name: 'amplify-vars', entry: 'infra/lambda/amplify-vars.mjs', memoryMb: 128, timeoutSeconds: 30 });
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['amplify:GetBranch', 'amplify:UpdateBranch'], resources: [branchArn] }));
    const provider = new cr.Provider(this, 'AmplifyVarsProvider', {
      onEventHandler: fn,
      logGroup: new logs.LogGroup(this, 'AmplifyVarsProviderLogs', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });
    const vars = new cdk.CustomResource(this, 'AmplifyBranchVariables', {
      serviceToken: provider.serviceToken,
      resourceType: 'Custom::AmplifyBranchVariables',
      properties: { AppId: appId, BranchName: branchName, Variables: variables },
    });
    vars.node.addDependency(branch);
  }
}
