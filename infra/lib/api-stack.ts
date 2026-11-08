import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource, SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import { makeFunction } from './function';
import { readStageValues } from './stage-values';

/** The HTTP API's access log group, by fixed name so the alarms stack can filter it without a reference. */
export const apiAccessLogGroupName = (stage: string) => `/aws/apigateway/smart-finances-${stage}-api-access`;

export interface ApiStackProps extends cdk.StackProps {
  stage: string;
  /** Kept for the stage wiring; the API has no browser rule (D-81), the web server calls it. */
  webOrigins: string[];
}

/**
 * HTTP API for one stage. GET /health is public; every data route binds `authorizer`, which
 * trusts only this stage's user pool and its two clients. Reads run on api-read, changes on
 * api-write, delete-all on api-delete; an S3 Object Created event under uploads/ runs the parser,
 * and the table stream runs the rollup (architecture "API stack"). The API publishes its address
 * as api-url and the delete function's name as delete-function-name for the web stack.
 */
export class ApiStack extends cdk.Stack {
  readonly stage: string;
  readonly webOrigins: string[];
  /** The data stack's values, read from SSM on every deploy (D-33; no CloudFormation imports). */
  readonly data: { tableName: string; tableStreamArn: string; bucketName: string; userPoolId: string; userPoolClientId: string; webClientId: string };
  readonly httpApi: apigw.HttpApi;
  readonly authorizer: HttpJwtAuthorizer;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    this.stage = props.stage;
    this.webOrigins = props.webOrigins;

    const values = readStageValues(this, props.stage, ['table-name', 'table-stream-arn', 'bucket-name', 'user-pool-id', 'user-pool-client-id', 'web-client-id']);
    this.data = {
      tableName: values['table-name'],
      tableStreamArn: values['table-stream-arn'],
      bucketName: values['bucket-name'],
      userPoolId: values['user-pool-id'],
      userPoolClientId: values['user-pool-client-id'],
      webClientId: values['web-client-id'],
    };

    // No browser rule: only the web server calls the API (D-81).
    this.httpApi = new apigw.HttpApi(this, 'Api', { apiName: `smart-finances-${props.stage}` });

    // Throttle the default stage for many people, still bounded so a loop or abuse cannot run up cost (D-81).
    const stage = this.httpApi.defaultStage?.node.defaultChild as apigw.CfnStage;
    stage.defaultRouteSettings = { throttlingRateLimit: 50, throttlingBurstLimit: 100 };

    // JSON access log, so the alarms stack can count 429s (HTTP APIs publish no throttle metric).
    // Request id, time, route key and status only: no source IP, identity, user agent or path values.
    const accessLogs = new logs.LogGroup(this, 'AccessLogs', {
      logGroupName: apiAccessLogGroupName(props.stage),
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    stage.accessLogSettings = {
      destinationArn: accessLogs.logGroupArn,
      format: JSON.stringify({
        requestId: '$context.requestId',
        requestTime: '$context.requestTime',
        routeKey: '$context.routeKey',
        status: '$context.status',
      }),
    };

    // Tokens must come from this stage's pool, issued to the public client or the web-server
    // client (D-53, D-73); the public client leaves once the web server signs in on qa (D-98).
    // The person is the sub claim.
    this.authorizer = new HttpJwtAuthorizer('Jwt', `https://cognito-idp.${this.region}.amazonaws.com/${this.data.userPoolId}`, {
      jwtAudience: [this.data.userPoolClientId, this.data.webClientId],
    });

    const health = makeFunction(this, { name: 'health', entry: 'apps/api/src/hello/index.mjs', memoryMb: 128, timeoutSeconds: 5 });
    this.httpApi.addRoutes({
      path: '/health',
      methods: [apigw.HttpMethod.GET],
      integration: new HttpLambdaIntegration('HealthIntegration', health),
    });

    this.addDataFunctions();

    new cdk.CfnOutput(this, 'ApiUrl', { value: this.httpApi.apiEndpoint });
    new ssm.StringParameter(this, 'ApiUrlParam', {
      parameterName: `/smart-finances/${props.stage}/api-url`,
      stringValue: this.httpApi.apiEndpoint,
    });
  }

  /** api-read, api-write, api-delete, parser and rollup, each with only the table, bucket, stream and invoke rights it uses. */
  private addDataFunctions() {
    const tableArn = this.formatArn({ service: 'dynamodb', resource: 'table', resourceName: this.data.tableName });
    const uploadsArn = `arn:${this.partition}:s3:::${this.data.bucketName}/uploads/*`;
    const allow = (fn: cdk.aws_lambda.IFunction, actions: string[], resources: string[]) =>
      fn.addToRolePolicy(new iam.PolicyStatement({ actions, resources }));
    const tableRead = ['dynamodb:GetItem', 'dynamodb:Query'];
    const tableWrite = [...tableRead, 'dynamodb:PutItem', 'dynamodb:ConditionCheckItem'];

    // Five minutes, below the ten-minute period lock. Async retries stay at 2, no on-failure destination.
    const parser = makeFunction(this, {
      name: 'parser',
      entry: 'apps/api/src/handlers/parser.mjs',
      memoryMb: 1024,
      timeoutSeconds: 300,
      environment: { TABLE_NAME: this.data.tableName, BUCKET_NAME: this.data.bucketName },
    });
    parser.configureAsyncInvoke({ retryAttempts: 2 });
    allow(parser, [...tableWrite, 'dynamodb:DeleteItem'], [tableArn]);
    allow(parser, ['s3:GetObject', 's3:DeleteObject'], [uploadsArn]);

    const read = makeFunction(this, {
      name: 'api-read',
      entry: 'apps/api/src/handlers/read.mjs',
      memoryMb: 256,
      timeoutSeconds: 10,
      environment: { TABLE_NAME: this.data.tableName },
    });
    allow(read, tableRead, [tableArn]);

    // A presigned upload form acts with its signer's rights, so api-write holds s3:PutObject.
    const write = makeFunction(this, {
      name: 'api-write',
      entry: 'apps/api/src/handlers/write.mjs',
      memoryMb: 256,
      timeoutSeconds: 10,
      environment: { TABLE_NAME: this.data.tableName, BUCKET_NAME: this.data.bucketName, PARSER_FUNCTION: parser.functionName },
    });
    const rollup = this.addRollup(tableArn);
    write.addEnvironment('ROLLUP_FUNCTION', rollup.functionName);
    allow(write, tableWrite, [tableArn]);
    allow(write, ['s3:PutObject'], [uploadsArn]);
    allow(write, ['lambda:InvokeFunction'], [parser.functionArn, rollup.functionArn]);

    // Delete-all, from DELETE /data or a direct invoke of { sub } by the web stack's job (D-40).
    // It puts and checks the erase marker, so it also holds PutItem.
    const erase = makeFunction(this, {
      name: 'api-delete',
      entry: 'apps/api/src/handlers/delete.mjs',
      memoryMb: 256,
      timeoutSeconds: 25,
      environment: { TABLE_NAME: this.data.tableName, BUCKET_NAME: this.data.bucketName },
    });
    allow(erase, [...tableRead, 'dynamodb:PutItem', 'dynamodb:DeleteItem'], [tableArn]);
    erase.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:ListBucket'],
      resources: [`arn:${this.partition}:s3:::${this.data.bucketName}`],
      conditions: { StringLike: { 's3:prefix': 'uploads/*' } },
    }));
    allow(erase, ['s3:DeleteObject'], [uploadsArn]);
    new ssm.StringParameter(this, 'DeleteFunctionNameParam', {
      parameterName: `/smart-finances/${this.stage}/delete-function-name`,
      stringValue: erase.functionName,
    });

    const GET = apigw.HttpMethod.GET;
    const POST = apigw.HttpMethod.POST;
    const PUT = apigw.HttpMethod.PUT;
    const routes: [apigw.HttpMethod, string, lambda.IFunction][] = [
      [GET, '/imports', read],
      [GET, '/imports/{id}', read],
      [GET, '/transactions', read],
      [GET, '/totals', read],
      [GET, '/review', read],
      [GET, '/rates', read],
      [GET, '/export', read],
      [POST, '/imports', write],
      [POST, '/imports/{id}/undo', write],
      [POST, '/periods/{source}/{period}/repair', write],
      [PUT, '/transactions/{id}/review', write],
      [PUT, '/rates/{month}', write],
      [POST, '/totals/rebuild', write],
      [apigw.HttpMethod.DELETE, '/data', erase],
    ];
    const integrations = new Map<lambda.IFunction, HttpLambdaIntegration>([
      [read, new HttpLambdaIntegration('ReadIntegration', read)],
      [write, new HttpLambdaIntegration('WriteIntegration', write)],
      [erase, new HttpLambdaIntegration('DeleteIntegration', erase)],
    ]);
    for (const [method, path, fn] of routes) {
      this.httpApi.addRoutes({ path, methods: [method], integration: integrations.get(fn)!, authorizer: this.authorizer });
    }

    new events.Rule(this, 'UploadCreated', {
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: { bucket: { name: [this.data.bucketName] }, object: { key: [{ prefix: 'uploads/' }] } },
      },
      targets: [new targets.LambdaFunction(parser)],
    });
  }

  /**
   * The rollup: the table's keys-only stream, filtered to row and review-choice keys, recomputes
   * each touched month. A batch that still fails after bisecting and 3 retries goes to a 14-day
   * queue; any message there alarms a topic the owner subscribes an email to (architecture "Rollup").
   */
  private addRollup(tableArn: string): lambda.IFunction {
    const rollup = makeFunction(this, {
      name: 'rollup',
      entry: 'apps/api/src/handlers/rollup.mjs',
      memoryMb: 512,
      timeoutSeconds: 60,
      environment: { TABLE_NAME: this.data.tableName },
    });
    rollup.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:ConditionCheckItem'], resources: [tableArn] }));

    const failures = new sqs.Queue(this, 'RollupFailures', { retentionPeriod: cdk.Duration.days(14) });
    // The stream source grants the stream reads, and dynamodb:ListStreams on "*" (D-34).
    const table = dynamodb.Table.fromTableAttributes(this, 'Table', { tableName: this.data.tableName, tableStreamArn: this.data.tableStreamArn });
    const keyStartsWith = (prefix: string) => ({ dynamodb: { Keys: { sk: { S: lambda.FilterRule.beginsWith(prefix) } } } });
    rollup.addEventSource(new DynamoEventSource(table, {
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      filters: [lambda.FilterCriteria.filter(keyStartsWith('TXN#')), lambda.FilterCriteria.filter(keyStartsWith('OVR#'))],
      batchSize: 100,
      parallelizationFactor: 1,
      bisectBatchOnError: true,
      retryAttempts: 3,
      maxRecordAge: cdk.Duration.hours(1),
      onFailure: new SqsDlq(failures),
    }));

    const topic = new sns.Topic(this, 'RollupFailuresTopic', { topicName: `smart-finances-${this.stage}-rollup-failures` });
    const alarm = new cloudwatch.Alarm(this, 'RollupFailuresAlarm', {
      alarmDescription: 'A rollup batch reached the on-failure queue; run POST /totals/rebuild after fixing the cause.',
      metric: failures.metricApproximateNumberOfMessagesVisible({ statistic: cloudwatch.Stats.MAXIMUM, period: cdk.Duration.minutes(1) }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    alarm.addAlarmAction(new cwActions.SnsAction(topic));
    return rollup;
  }
}
