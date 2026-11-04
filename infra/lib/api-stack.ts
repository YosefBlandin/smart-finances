import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as logs from 'aws-cdk-lib/aws-logs';
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
 * trusts only this stage's user pool and its two clients. Data routes arrive in later PRs.
 * The API publishes its address as api-url for the web stack.
 */
export class ApiStack extends cdk.Stack {
  readonly stage: string;
  readonly webOrigins: string[];
  /** The data stack's values, read from SSM on every deploy (D-33; no CloudFormation imports). */
  readonly data: { tableName: string; bucketName: string; userPoolId: string; userPoolClientId: string; webClientId: string };
  readonly httpApi: apigw.HttpApi;
  readonly authorizer: HttpJwtAuthorizer;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    this.stage = props.stage;
    this.webOrigins = props.webOrigins;

    const values = readStageValues(this, props.stage, ['table-name', 'bucket-name', 'user-pool-id', 'user-pool-client-id', 'web-client-id']);
    this.data = {
      tableName: values['table-name'],
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

    new cdk.CfnOutput(this, 'ApiUrl', { value: this.httpApi.apiEndpoint });
    new ssm.StringParameter(this, 'ApiUrlParam', {
      parameterName: `/smart-finances/${props.stage}/api-url`,
      stringValue: this.httpApi.apiEndpoint,
    });
  }
}
