import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import { makeFunction } from './function';

export interface ApiStackProps extends cdk.StackProps {
  stage: string;
  webOrigins: string[];
}

/**
 * HTTP API for one stage. GET /health is public; every data route binds `authorizer`, which
 * trusts only this stage's user pool and app client. Data routes arrive in later PRs.
 */
export class ApiStack extends cdk.Stack {
  readonly stage: string;
  readonly webOrigins: string[];
  /** The data stack's values, read from SSM at deploy time (no CloudFormation imports). */
  readonly data: { tableName: string; bucketName: string; userPoolId: string; userPoolClientId: string };
  readonly httpApi: apigw.HttpApi;
  readonly authorizer: HttpJwtAuthorizer;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    this.stage = props.stage;
    this.webOrigins = props.webOrigins;

    const param = (name: string) => ssm.StringParameter.valueForStringParameter(this, `/smart-finances/${props.stage}/${name}`);
    this.data = {
      tableName: param('table-name'),
      bucketName: param('bucket-name'),
      userPoolId: param('user-pool-id'),
      userPoolClientId: param('user-pool-client-id'),
    };

    this.httpApi = new apigw.HttpApi(this, 'Api', {
      apiName: `smart-finances-${props.stage}`,
      corsPreflight: props.webOrigins.length
        ? {
            allowOrigins: props.webOrigins,
            allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST, apigw.CorsHttpMethod.PUT, apigw.CorsHttpMethod.DELETE],
            allowHeaders: ['authorization', 'content-type'],
            maxAge: cdk.Duration.hours(1),
          }
        : undefined,
    });

    // Throttle the default stage so a loop or abuse cannot run up cost.
    const stage = this.httpApi.defaultStage?.node.defaultChild as apigw.CfnStage;
    stage.defaultRouteSettings = { throttlingRateLimit: 10, throttlingBurstLimit: 20 };

    // Tokens must come from this stage's pool, issued to its web client. The person is the sub claim.
    this.authorizer = new HttpJwtAuthorizer('Jwt', `https://cognito-idp.${this.region}.amazonaws.com/${this.data.userPoolId}`, {
      jwtAudience: [this.data.userPoolClientId],
    });

    const health = makeFunction(this, { name: 'health', entry: 'apps/api/src/hello/index.mjs', memoryMb: 128, timeoutSeconds: 5 });
    this.httpApi.addRoutes({
      path: '/health',
      methods: [apigw.HttpMethod.GET],
      integration: new HttpLambdaIntegration('HealthIntegration', health),
    });

    new cdk.CfnOutput(this, 'ApiUrl', { value: this.httpApi.apiEndpoint });
  }
}
