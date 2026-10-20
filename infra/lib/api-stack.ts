import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  stage: string;
}

/** Hello-world API: HTTP API -> one Lambda with its own role. Replaced by real functions in Epic 2. */
export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const reservedRaw = this.node.tryGetContext('reservedConcurrency');
    const reservedConcurrency = reservedRaw === undefined ? undefined : Number(reservedRaw);

    const logGroup = new logs.LogGroup(this, 'HelloLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // One dedicated role per function. Only permission: write to its own log group.
    const helloRole = new iam.Role(this, 'HelloRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    logGroup.grantWrite(helloRole);

    const hello = new lambda.Function(this, 'Hello', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../apps/api/src/hello')),
      role: helloRole,
      logGroup,
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
      // Off by default: new AWS accounts start with a Lambda concurrency quota of 10 and AWS
      // requires 10 to stay unreserved, so no reservation is possible until the quota is raised.
      // Enable later with: cdk deploy -c reservedConcurrency=5
      reservedConcurrentExecutions: reservedConcurrency,
      environment: { STAGE: props.stage },
    });

    const api = new apigw.HttpApi(this, 'Api', {
      apiName: `smart-finances-${props.stage}`,
      defaultIntegration: new HttpLambdaIntegration('HelloIntegration', hello),
    });

    // Throttle the default stage so a loop or abuse cannot run up cost.
    const stage = api.defaultStage?.node.defaultChild as apigw.CfnStage;
    stage.defaultRouteSettings = { throttlingRateLimit: 10, throttlingBurstLimit: 20 };

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
  }
}
