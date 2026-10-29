import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Template } from 'aws-cdk-lib/assertions';
import * as fs from 'fs';
import * as path from 'path';
import { makeFunction } from '../lib/function';
import { addStage } from '../lib/stage';

const env = { account: '111111111111', region: 'us-east-1' };
const STAGES = ['dev', 'qa', 'staging', 'prod'];
const context = {
  webOrigins: { dev: ['http://localhost:3000'], qa: ['http://localhost:3000'], staging: [], prod: [] },
};

type Resource = { Type: string; Properties: Record<string, any> };
const resources = (stack: cdk.Stack) => Template.fromStack(stack).toJSON().Resources as Record<string, Resource>;
const ofType = (all: Record<string, Resource>, type: string) => Object.entries(all).filter(([, r]) => r.Type === type);

test('T-INF-7 GET /health has no authorizer, there is no default route, throttling is 10 and 20, functions are named per stage', () => {
  for (const stage of STAGES) {
    const { api } = addStage(new cdk.App({ context }), stage, env);
    const all = resources(api);

    const routes = ofType(all, 'AWS::ApiGatewayV2::Route').map(([, r]) => r.Properties);
    assert.deepEqual(routes.map((r) => r.RouteKey), ['GET /health'], 'only the health route, no $default');
    assert.ok([undefined, 'NONE'].includes(routes[0].AuthorizationType), 'health has no authorizer');
    assert.equal(routes[0].AuthorizerId, undefined);

    const [[, httpApi]] = ofType(all, 'AWS::ApiGatewayV2::Api');
    assert.equal(httpApi.Properties.Name, `smart-finances-${stage}`);
    const origins = context.webOrigins[stage as keyof typeof context.webOrigins];
    if (origins.length) assert.deepEqual(httpApi.Properties.CorsConfiguration.AllowOrigins, origins);
    else assert.equal(httpApi.Properties.CorsConfiguration, undefined, 'no CORS without web origins');

    const [[, apiStage]] = ofType(all, 'AWS::ApiGatewayV2::Stage');
    assert.deepEqual(apiStage.Properties.DefaultRouteSettings, { ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 });

    const functions = ofType(all, 'AWS::Lambda::Function').map(([, r]) => r.Properties);
    assert.deepEqual(functions.map((f) => f.FunctionName), [`smart-finances-${stage}-health`]);
    const [health] = functions;
    assert.equal(health.Runtime, 'nodejs22.x');
    assert.equal(health.MemorySize, 128);
    assert.equal(health.Timeout, 5);
    assert.equal(health.Environment.Variables.STAGE, stage);
    assert.equal(health.ReservedConcurrentExecutions, undefined, 'no reservation unless asked for');
    const [[, logGroup]] = ofType(all, 'AWS::Logs::LogGroup');
    assert.equal(logGroup.Properties.RetentionInDays, 30);
    assert.equal(health.LoggingConfig.LogGroup.Ref, ofType(all, 'AWS::Logs::LogGroup')[0][0]);
  }

  // The reservedConcurrency switch still works.
  const reserved = addStage(new cdk.App({ context: { ...context, reservedConcurrency: '5' } }), 'dev', env);
  const [[, fn]] = ofType(resources(reserved.api), 'AWS::Lambda::Function');
  assert.equal(fn.Properties.ReservedConcurrentExecutions, 5);
});

test('T-INF-7 the JWT authorizer trusts the stage pool as issuer and its app client as audience', () => {
  const { api } = addStage(new cdk.App({ context }), 'qa', env);
  // No route binds the authorizer in this PR; bind it to a probe route to see what it synthesizes.
  const probe = new cdk.aws_lambda.Function(api, 'Probe', {
    runtime: cdk.aws_lambda.Runtime.NODEJS_22_X,
    handler: 'index.handler',
    code: cdk.aws_lambda.Code.fromInline('exports.handler = async () => ({})'),
  });
  api.httpApi.addRoutes({
    path: '/probe',
    methods: [apigw.HttpMethod.GET],
    integration: new HttpLambdaIntegration('ProbeIntegration', probe),
    authorizer: api.authorizer,
  });
  const all = resources(api);
  const [[authorizerId, authorizer]] = ofType(all, 'AWS::ApiGatewayV2::Authorizer');
  assert.equal(authorizer.Properties.AuthorizerType, 'JWT');
  assert.deepEqual(authorizer.Properties.IdentitySource, ['$request.header.Authorization']);

  const params = Template.fromStack(api).toJSON().Parameters as Record<string, { Default?: string }>;
  const paramFor = (name: string) => Object.entries(params).find(([, p]) => p.Default === `/smart-finances/qa/${name}`)![0];
  assert.deepEqual(authorizer.Properties.JwtConfiguration, {
    Audience: [{ Ref: paramFor('user-pool-client-id') }],
    Issuer: { 'Fn::Join': ['', ['https://cognito-idp.us-east-1.amazonaws.com/', { Ref: paramFor('user-pool-id') }]] },
  });
  const probeRoute = ofType(all, 'AWS::ApiGatewayV2::Route').find(([, r]) => r.Properties.RouteKey === 'GET /probe')![1];
  assert.equal(probeRoute.Properties.AuthorizationType, 'JWT');
  assert.equal(probeRoute.Properties.AuthorizerId.Ref, authorizerId);
});

const hasStar = (resource: unknown): boolean =>
  resource === '*' || (Array.isArray(resource) && resource.some(hasStar));

test('T-INF-8 no policy on the role of a function this repo defines has a "*" resource', () => {
  for (const stage of STAGES) {
    const { api } = addStage(new cdk.App({ context }), stage, env);
    const all = resources(api);
    const ours = ofType(all, 'AWS::Lambda::Function')
      .filter(([, fn]) => String(fn.Properties.FunctionName ?? '').startsWith(`smart-finances-${stage}-`))
      .map(([, fn]) => fn.Properties.Role['Fn::GetAtt'][0] as string);
    assert.ok(ours.length > 0, 'at least one function of this repo');
    assert.equal(new Set(ours).size, ours.length, 'one role per function');

    for (const roleId of ours) {
      const role = all[roleId];
      assert.equal(role.Type, 'AWS::IAM::Role');
      assert.equal(role.Properties.ManagedPolicyArns, undefined, `${roleId} has no managed policies`);
      const statements = [
        ...(role.Properties.Policies ?? []).flatMap((p: any) => p.PolicyDocument.Statement),
        ...[...ofType(all, 'AWS::IAM::Policy'), ...ofType(all, 'AWS::IAM::ManagedPolicy')]
          .filter(([, p]) => (p.Properties.Roles ?? []).some((r: any) => r.Ref === roleId))
          .flatMap(([, p]) => p.Properties.PolicyDocument.Statement),
      ];
      assert.ok(statements.length > 0, `${roleId} has its own policy`);
      for (const statement of statements) {
        assert.equal(hasStar(statement.Resource), false, `${roleId}: ${JSON.stringify(statement.Action)} has a "*" resource`);
      }
    }
  }
});

test('T-INF-7 makeFunction bundles the pinned AWS SDK instead of using the runtime copy', () => {
  const app = new cdk.App({ context });
  const { api } = addStage(app, 'dev', env);
  // repo.mjs imports the DynamoDB, S3, presigned-post and Lambda clients.
  const fn = makeFunction(api, { name: 'bundle-probe', entry: 'apps/api/src/store/repo.mjs', memoryMb: 128, timeoutSeconds: 5 });
  assert.equal((fn.node.defaultChild as cdk.aws_lambda.CfnFunction).functionName, 'smart-finances-dev-bundle-probe');
  const assembly = app.synth();
  const template = assembly.getStackByName(api.stackName).template;
  const probe = Object.values(template.Resources as Record<string, Resource>)
    .find((r) => r.Type === 'AWS::Lambda::Function' && r.Properties.FunctionName === 'smart-finances-dev-bundle-probe')!;
  const assetDir = path.join(assembly.directory, `asset.${String(probe.Properties.Code.S3Key).replace(/\.zip$/, '')}`);
  const bundle = fs.readFileSync(path.join(assetDir, 'index.mjs'), 'utf8');
  // The only imports left are the SDK's optional SigV4a signers, which it requires inside a
  // try/catch and which no handler here needs.
  const optional = new Set(['@aws-sdk/signature-v4-crt', '@aws-sdk/signature-v4a']);
  const left = [...bundle.matchAll(/(?:from\s*|import\(\s*|require\(\s*)["'](@(?:aws-sdk|smithy)\/[^"']+)["']/g)]
    .map((m) => m[1])
    .filter((name) => !optional.has(name));
  assert.deepEqual([...new Set(left)], [], 'no @aws-sdk or @smithy import is left for the runtime to resolve');
  assert.ok(bundle.length > 100_000, 'the SDK is inside the bundle');
});
