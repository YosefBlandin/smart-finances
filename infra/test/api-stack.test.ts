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
import { apiAccessLogGroupName } from '../lib/api-stack';

const env = { account: '111111111111', region: 'us-east-1' };
const STAGES = ['dev', 'qa', 'staging', 'prod'];
const context = {
  webOrigins: { dev: ['http://localhost:3000'], qa: ['http://localhost:3000'], staging: [], prod: [] },
};

// CDK's AwsCustomResource singleton: CDK's own function, not one this repo defines.
const CR_SINGLETON = 'AWS679f53fac002430cb0da5b7982bd2287';
type Resource = { Type: string; Properties: Record<string, any>; DependsOn?: string[] };
const resources = (stack: cdk.Stack) => Template.fromStack(stack).toJSON().Resources as Record<string, Resource>;
const ofType = (all: Record<string, Resource>, type: string) => Object.entries(all).filter(([, r]) => r.Type === type);

test('T-INF-7 GET /health has no authorizer, there is no default route, throttling is 50 and 100 (D-81), functions are named per stage', () => {
  for (const stage of STAGES) {
    const { api } = addStage(new cdk.App({ context }), stage, env);
    const all = resources(api);

    const routes = ofType(all, 'AWS::ApiGatewayV2::Route').map(([, r]) => r.Properties);
    assert.deepEqual(routes.map((r) => r.RouteKey), ['GET /health'], 'only the health route, no $default');
    assert.ok([undefined, 'NONE'].includes(routes[0].AuthorizationType), 'health has no authorizer');
    assert.equal(routes[0].AuthorizerId, undefined);

    const [[, httpApi]] = ofType(all, 'AWS::ApiGatewayV2::Api');
    assert.equal(httpApi.Properties.Name, `smart-finances-${stage}`);
    assert.equal(httpApi.Properties.CorsConfiguration, undefined, 'no API browser rule, even with web origins (D-81)');

    const [[, apiStage]] = ofType(all, 'AWS::ApiGatewayV2::Stage');
    assert.deepEqual(apiStage.Properties.DefaultRouteSettings, { ThrottlingRateLimit: 50, ThrottlingBurstLimit: 100 });

    const functions = ofType(all, 'AWS::Lambda::Function').filter(([id]) => !id.startsWith(CR_SINGLETON)).map(([, r]) => r.Properties);
    assert.deepEqual(functions.map((f) => f.FunctionName), [`smart-finances-${stage}-health`]);
    const [health] = functions;
    assert.equal(health.Runtime, 'nodejs22.x');
    assert.equal(health.MemorySize, 128);
    assert.equal(health.Timeout, 5);
    assert.equal(health.Environment.Variables.STAGE, stage);
    assert.equal(health.ReservedConcurrentExecutions, undefined, 'no reservation unless asked for');
    const healthLogs = all[health.LoggingConfig.LogGroup.Ref];
    assert.equal(healthLogs.Type, 'AWS::Logs::LogGroup');
    assert.equal(healthLogs.Properties.RetentionInDays, 30);
  }

  // The reservedConcurrency switch still works.
  const reserved = addStage(new cdk.App({ context: { ...context, reservedConcurrency: '5' } }), 'dev', env);
  const [[, fn]] = ofType(resources(reserved.api), 'AWS::Lambda::Function').filter(([id]) => !id.startsWith(CR_SINGLETON));
  assert.equal(fn.Properties.ReservedConcurrentExecutions, 5);
});

test('T-INF-7 the JWT authorizer trusts the stage pool as issuer and both its clients as audience', () => {
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

  const [[readerId]] = ofType(all, 'Custom::AWS');
  assert.deepEqual(authorizer.Properties.JwtConfiguration, {
    Audience: [{ 'Fn::GetAtt': [readerId, 'Parameters.2.Value'] }, { 'Fn::GetAtt': [readerId, 'Parameters.4.Value'] }],
    Issuer: { 'Fn::Join': ['', ['https://cognito-idp.us-east-1.amazonaws.com/', { 'Fn::GetAtt': [readerId, 'Parameters.3.Value'] }]] },
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

const NAMES = ['bucket-name', 'table-name', 'user-pool-client-id', 'user-pool-id', 'web-client-id'];
const ssmArn = (stage: string, name: string) => ({
  'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, `:ssm:us-east-1:111111111111:parameter/smart-finances/${stage}/${name}`]],
});

test('T-INF-13 one custom resource reads the five SSM values; no SSM template parameters; its policy names only their ARNs', () => {
  for (const stage of STAGES) {
    const { api } = addStage(new cdk.App({ context }), stage, env);
    const json = Template.fromStack(api).toJSON();
    const all = json.Resources as Record<string, Resource>;

    // CDK's own BootstrapVersion parameter stays; it is the one the deploy role may read.
    const ssmParams = Object.values((json.Parameters ?? {}) as Record<string, { Type: string; Default?: string }>)
      .filter((p) => p.Type.startsWith('AWS::SSM::Parameter::Value') && p.Default !== '/cdk-bootstrap/hnb659fds/version');
    assert.deepEqual(ssmParams, [], `${stage}: no SSM-typed template parameters, which the CDK deploy role cannot resolve`);

    const readers = ofType(all, 'Custom::AWS');
    assert.equal(readers.length, 1, 'one custom resource');
    const [[readerId, reader]] = readers;
    const create = JSON.parse(reader.Properties.Create);
    const update = JSON.parse(reader.Properties.Update);
    for (const call of [create, update]) {
      assert.equal(call.service, 'SSM');
      assert.equal(call.action, 'getParameters');
      // Sorted, because GetParameters answers in name order: Parameters.<i> is NAMES[i] either way.
      assert.deepEqual(call.parameters.Names, NAMES.map((n) => `/smart-finances/${stage}/${n}`));
      assert.deepEqual(call.outputPaths, NAMES.map((_, i) => `Parameters.${i}.Value`));
    }

    // The physical id changes on every synth, so every deploy re-reads.
    const again = Template.fromStack(addStage(new cdk.App({ context }), stage, env).api).toJSON();
    const [[, readerAgain]] = ofType(again.Resources, 'Custom::AWS');
    assert.notEqual(JSON.parse(readerAgain.Properties.Update).physicalResourceId.id, update.physicalResourceId.id);

    // Its policy: ssm:GetParameters on exactly the five parameter ARNs, nothing else, no "*".
    const policies = ofType(all, 'AWS::IAM::Policy').filter(([id]) => reader.DependsOn?.includes(id));
    assert.equal(policies.length, 1);
    const statements = policies[0][1].Properties.PolicyDocument.Statement;
    assert.deepEqual(statements, [{ Action: 'ssm:GetParameters', Effect: 'Allow', Resource: NAMES.map((n) => ssmArn(stage, n)) }]);

    // The reader's function has its own role with no managed policies, and one-month logs.
    const [[, singleton]] = ofType(all, 'AWS::Lambda::Function').filter(([id]) => id.startsWith(CR_SINGLETON));
    const roleId = singleton.Properties.Role['Fn::GetAtt'][0];
    assert.deepEqual(policies[0][1].Properties.Roles, [{ Ref: roleId }]);
    assert.equal(all[roleId].Properties.ManagedPolicyArns, undefined, 'no managed policy, so no "*"');
    const roleStatements = ofType(all, 'AWS::IAM::Policy')
      .filter(([, p]) => p.Properties.Roles.some((r: any) => r.Ref === roleId))
      .flatMap(([, p]) => p.Properties.PolicyDocument.Statement);
    for (const statement of roleStatements) assert.equal(hasStar(statement.Resource), false, JSON.stringify(statement.Action));
    assert.equal(all[singleton.Properties.LoggingConfig.LogGroup.Ref].Properties.RetentionInDays, 30);

    // ApiStack.data comes from that resource, by name.
    const field = (token: string) => api.resolve(token)['Fn::GetAtt'];
    assert.deepEqual(field(api.data.bucketName), [readerId, 'Parameters.0.Value']);
    assert.deepEqual(field(api.data.tableName), [readerId, 'Parameters.1.Value']);
    assert.deepEqual(field(api.data.userPoolClientId), [readerId, 'Parameters.2.Value']);
    assert.deepEqual(field(api.data.userPoolId), [readerId, 'Parameters.3.Value']);
    assert.deepEqual(field(api.data.webClientId), [readerId, 'Parameters.4.Value']);
  }
});

test('T-WINF-6 the API serves many people: both clients in the audience, throttle 50 and 100, no API or bucket browser rule, api-url published', () => {
  for (const stage of STAGES) {
    const app = new cdk.App({ context });
    const { data, api } = addStage(app, stage, env);
    // Bind the authorizer to a probe route before synth so the audience is in the template.
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

    const [[readerId, reader]] = ofType(all, 'Custom::AWS');
    const names: string[] = JSON.parse(reader.Properties.Create).parameters.Names;
    assert.ok(names.includes(`/smart-finances/${stage}/web-client-id`), 'the API reads web-client-id');
    const index = (name: string) => names.indexOf(`/smart-finances/${stage}/${name}`);

    const [[, authorizer]] = ofType(all, 'AWS::ApiGatewayV2::Authorizer');
    assert.deepEqual(authorizer.Properties.JwtConfiguration.Audience, [
      { 'Fn::GetAtt': [readerId, `Parameters.${index('user-pool-client-id')}.Value`] },
      { 'Fn::GetAtt': [readerId, `Parameters.${index('web-client-id')}.Value`] },
    ], 'the public client and the web-server client');

    const [[, httpApi]] = ofType(all, 'AWS::ApiGatewayV2::Api');
    assert.equal(httpApi.Properties.CorsConfiguration, undefined, `${stage}: no API browser rule`);

    const [[, apiStage]] = ofType(all, 'AWS::ApiGatewayV2::Stage');
    assert.deepEqual(apiStage.Properties.DefaultRouteSettings, { ThrottlingRateLimit: 50, ThrottlingBurstLimit: 100 });

    const params = ofType(all, 'AWS::SSM::Parameter').map(([, r]) => r.Properties);
    assert.equal(params.length, 1, 'one published parameter');
    assert.equal(params[0].Name, `/smart-finances/${stage}/api-url`);
    assert.equal(params[0].Type, 'String');
    const [[apiId]] = ofType(all, 'AWS::ApiGatewayV2::Api');
    assert.ok(JSON.stringify(params[0].Value).includes(apiId), 'the value is the HTTP API endpoint');

    const buckets = ofType(resources(data), 'AWS::S3::Bucket');
    assert.equal(buckets.length, 1);
    assert.equal(buckets[0][1].Properties.CorsConfiguration, undefined, `${stage}: the data stack sets no bucket browser rule (D-88)`);
  }
});

test('T-WINF-12 the API stage writes a JSON access log (status, route key, request time, request id only) kept one month', () => {
  for (const stage of STAGES) {
    const { api } = addStage(new cdk.App({ context }), stage, env);
    const json = Template.fromStack(api).toJSON();
    const all = json.Resources as Record<string, Resource & { DeletionPolicy?: string }>;

    assert.equal(apiAccessLogGroupName(stage), `/aws/apigateway/smart-finances-${stage}-api-access`);
    const groups = ofType(all, 'AWS::Logs::LogGroup').filter(([, g]) => g.Properties.LogGroupName === apiAccessLogGroupName(stage));
    assert.equal(groups.length, 1, `${stage}: one access log group by its fixed name`);
    const [[groupId, group]] = groups;
    assert.equal(group.Properties.RetentionInDays, 30, 'one month');
    assert.equal(all[groupId].DeletionPolicy, 'Delete', 'removed with the stack, so the fixed name can be created again');

    const [[, apiStage]] = ofType(all, 'AWS::ApiGatewayV2::Stage');
    const settings = apiStage.Properties.AccessLogSettings;
    assert.ok(settings, `${stage}: the stage has access logging`);
    assert.deepEqual(settings.DestinationArn, { 'Fn::GetAtt': [groupId, 'Arn'] });
    assert.deepEqual(JSON.parse(settings.Format), {
      requestId: '$context.requestId',
      requestTime: '$context.requestTime',
      routeKey: '$context.routeKey',
      status: '$context.status',
    });
    // No source IP, identity, user agent, path or path parameters, authorizer claims or errors with values.
    for (const banned of ['identity', 'sourceIp', 'userAgent', 'path', 'authorizer', 'requestTimeEpoch']) {
      assert.ok(!settings.Format.includes(`$context.${banned}`), `${stage}: no $context.${banned}`);
    }
  }
});
