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
// Every route of Contracts "HTTP routes" and the function that serves it (architecture "API stack").
const ALL_ROUTES: Record<string, string> = {
  'GET /health': 'health',
  'GET /imports': 'api-read',
  'GET /imports/{id}': 'api-read',
  'GET /transactions': 'api-read',
  'GET /totals': 'api-read',
  'GET /review': 'api-read',
  'GET /rates': 'api-read',
  'GET /export': 'api-read',
  'POST /imports': 'api-write',
  'POST /imports/{id}/undo': 'api-write',
  'POST /periods/{source}/{period}/repair': 'api-write',
  'PUT /transactions/{id}/review': 'api-write',
  'PUT /rates/{month}': 'api-write',
  'POST /totals/rebuild': 'api-write',
  'DELETE /data': 'api-delete',
};
const FUNCTIONS = ['api-delete', 'api-read', 'api-write', 'health', 'parser', 'rollup'];

test('T-INF-7 GET /health has no authorizer, there is no default route, throttling is 50 and 100 (D-81), functions are named per stage', () => {
  for (const stage of STAGES) {
    const { api } = addStage(new cdk.App({ context }), stage, env);
    const all = resources(api);

    const routes = ofType(all, 'AWS::ApiGatewayV2::Route').map(([, r]) => r.Properties);
    assert.deepEqual(routes.map((r) => r.RouteKey).sort(), Object.keys(ALL_ROUTES).sort(), 'the 15 routes, no $default');
    const healthRoute = routes.find((r) => r.RouteKey === 'GET /health')!;
    assert.ok([undefined, 'NONE'].includes(healthRoute.AuthorizationType), 'health has no authorizer');
    assert.equal(healthRoute.AuthorizerId, undefined);

    const [[, httpApi]] = ofType(all, 'AWS::ApiGatewayV2::Api');
    assert.equal(httpApi.Properties.Name, `smart-finances-${stage}`);
    assert.equal(httpApi.Properties.CorsConfiguration, undefined, 'no API browser rule, even with web origins (D-81)');

    const [[, apiStage]] = ofType(all, 'AWS::ApiGatewayV2::Stage');
    assert.deepEqual(apiStage.Properties.DefaultRouteSettings, { ThrottlingRateLimit: 50, ThrottlingBurstLimit: 100 });

    const functions = ofType(all, 'AWS::Lambda::Function').filter(([id]) => !id.startsWith(CR_SINGLETON)).map(([, r]) => r.Properties);
    assert.deepEqual(functions.map((f) => f.FunctionName).sort(), FUNCTIONS.map((n) => `smart-finances-${stage}-${n}`));
    const health = functions.find((f) => f.FunctionName === `smart-finances-${stage}-health`)!;
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
  const ours = ofType(resources(reserved.api), 'AWS::Lambda::Function').filter(([id]) => !id.startsWith(CR_SINGLETON));
  assert.ok(ours.length > 0 && ours.every(([, fn]) => fn.Properties.ReservedConcurrentExecutions === 5));
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
    Audience: [{ 'Fn::GetAtt': [readerId, 'Parameters.3.Value'] }, { 'Fn::GetAtt': [readerId, 'Parameters.5.Value'] }],
    Issuer: { 'Fn::Join': ['', ['https://cognito-idp.us-east-1.amazonaws.com/', { 'Fn::GetAtt': [readerId, 'Parameters.4.Value'] }]] },
  });
  const probeRoute = ofType(all, 'AWS::ApiGatewayV2::Route').find(([, r]) => r.Properties.RouteKey === 'GET /probe')![1];
  assert.equal(probeRoute.Properties.AuthorizationType, 'JWT');
  assert.equal(probeRoute.Properties.AuthorizerId.Ref, authorizerId);
});

const hasStar = (resource: unknown): boolean =>
  resource === '*' || (Array.isArray(resource) && resource.some(hasStar));

test('T-INF-8 no policy on the role of a function this repo defines has a "*" resource, except dynamodb:ListStreams on the rollup role (D-34)', () => {
  for (const stage of STAGES) {
    const { api } = addStage(new cdk.App({ context }), stage, env);
    const all = resources(api);
    const ours = ofType(all, 'AWS::Lambda::Function')
      .filter(([, fn]) => String(fn.Properties.FunctionName ?? '').startsWith(`smart-finances-${stage}-`))
      .map(([, fn]) => fn.Properties.Role['Fn::GetAtt'][0] as string);
    const rollupRole = fnNamed(all, `smart-finances-${stage}-rollup`).roleId;
    let listStreams = 0;
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
        if (roleId === rollupRole && statement.Action === 'dynamodb:ListStreams' && statement.Resource === '*') {
          listStreams += 1;
          continue;
        }
        assert.equal(hasStar(statement.Resource), false, `${roleId}: ${JSON.stringify(statement.Action)} has a "*" resource`);
      }
    }
    assert.equal(listStreams, 1, 'the one allowed "*" is ListStreams, alone, on the rollup role');
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

const NAMES = ['bucket-name', 'table-name', 'table-stream-arn', 'user-pool-client-id', 'user-pool-id', 'web-client-id'];
const ssmArn = (stage: string, name: string) => ({
  'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, `:ssm:us-east-1:111111111111:parameter/smart-finances/${stage}/${name}`]],
});

test('T-INF-13 one custom resource reads the six SSM values; no SSM template parameters; its policy names only their ARNs', () => {
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

    // Its policy: ssm:GetParameters on exactly the six parameter ARNs, nothing else, no "*".
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
    assert.deepEqual(field(api.data.tableStreamArn), [readerId, 'Parameters.2.Value']);
    assert.deepEqual(field(api.data.userPoolClientId), [readerId, 'Parameters.3.Value']);
    assert.deepEqual(field(api.data.userPoolId), [readerId, 'Parameters.4.Value']);
    assert.deepEqual(field(api.data.webClientId), [readerId, 'Parameters.5.Value']);
  }
});

test('T-WINF-6 the API serves many people: both clients in the audience, throttle 50 and 100, no API or bucket browser rule, api-url and delete-function-name published (D-40)', () => {
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
    assert.deepEqual(params.map((p) => p.Name).sort(), [`/smart-finances/${stage}/api-url`, `/smart-finances/${stage}/delete-function-name`]);
    assert.ok(params.every((p) => p.Type === 'String'));
    const [[apiId]] = ofType(all, 'AWS::ApiGatewayV2::Api');
    const apiUrl = params.find((p) => p.Name.endsWith('/api-url'))!;
    assert.ok(JSON.stringify(apiUrl.Value).includes(apiId), 'the value is the HTTP API endpoint');
    const deleteName = params.find((p) => p.Name.endsWith('/delete-function-name'))!;
    // The function's own name, by reference, so the two cannot drift; it is the name the web stack invokes.
    assert.deepEqual(deleteName.Value, { Ref: fnNamed(all, `smart-finances-${stage}-api-delete`).id });

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

// ---- SF-31: the import functions ----
type Statement = { Action: string | string[]; Resource: unknown; Condition?: unknown };
function statementsOf(all: Record<string, Resource>, roleId: string): Statement[] {
  return ofType(all, 'AWS::IAM::Policy')
    .filter(([, p]) => (p.Properties.Roles ?? []).some((r: any) => r.Ref === roleId))
    .flatMap(([, p]) => p.Properties.PolicyDocument.Statement);
}
const actionsOf = (statements: Statement[]) => statements.flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action])).sort();
function fnNamed(all: Record<string, Resource>, name: string) {
  const found = ofType(all, 'AWS::Lambda::Function').find(([, f]) => f.Properties.FunctionName === name);
  assert.ok(found, name);
  return { id: found![0], props: found![1].Properties, roleId: found![1].Properties.Role['Fn::GetAtt'][0] as string };
}
const integrationTarget = (all: Record<string, Resource>, route: Resource) => {
  const integration = all[String(route.Properties.Target['Fn::Join'][1][1].Ref)];
  return integration.Properties.IntegrationUri['Fn::GetAtt'][0];
};

test('T-INF-9 every import route binds the JWT authorizer and reaches its function', () => {
  const { api } = addStage(new cdk.App({ context }), 'qa', env);
  const all = resources(api);
  const [[authorizerId, authorizer]] = ofType(all, 'AWS::ApiGatewayV2::Authorizer');
  assert.equal(authorizer.Properties.AuthorizerType, 'JWT');
  const read = fnNamed(all, 'smart-finances-qa-api-read');
  const write = fnNamed(all, 'smart-finances-qa-api-write');
  const expected: Record<string, string> = {
    'GET /imports': read.id,
    'GET /imports/{id}': read.id,
    'POST /imports': write.id,
    'POST /imports/{id}/undo': write.id,
    'POST /periods/{source}/{period}/repair': write.id,
  };
  for (const [key, fnId] of Object.entries(expected)) {
    const [, route] = ofType(all, 'AWS::ApiGatewayV2::Route').find(([, r]) => r.Properties.RouteKey === key)!;
    assert.equal(route.Properties.AuthorizationType, 'JWT', key);
    assert.equal(route.Properties.AuthorizerId.Ref, authorizerId, key);
    assert.equal(integrationTarget(all, route), fnId, key);
  }
});

test('T-INF-9 sizes, environment and retries of the import functions', () => {
  const { api } = addStage(new cdk.App({ context }), 'qa', env);
  const all = resources(api);
  const read = fnNamed(all, 'smart-finances-qa-api-read').props;
  const write = fnNamed(all, 'smart-finances-qa-api-write').props;
  const parser = fnNamed(all, 'smart-finances-qa-parser');
  assert.deepEqual([read.MemorySize, read.Timeout, write.MemorySize, write.Timeout, parser.props.MemorySize, parser.props.Timeout], [256, 10, 256, 10, 1024, 300]);
  assert.deepEqual(Object.keys(read.Environment.Variables).sort(), ['STAGE', 'TABLE_NAME']);
  assert.deepEqual(Object.keys(write.Environment.Variables).sort(), ['BUCKET_NAME', 'PARSER_FUNCTION', 'ROLLUP_FUNCTION', 'STAGE', 'TABLE_NAME']);
  assert.deepEqual(write.Environment.Variables.PARSER_FUNCTION, { Ref: parser.id });
  assert.deepEqual(write.Environment.Variables.ROLLUP_FUNCTION, { Ref: fnNamed(all, 'smart-finances-qa-rollup').id });
  assert.deepEqual(Object.keys(parser.props.Environment.Variables).sort(), ['BUCKET_NAME', 'STAGE', 'TABLE_NAME']);
  const [[, invokeConfig]] = ofType(all, 'AWS::Lambda::EventInvokeConfig');
  assert.equal(invokeConfig.Properties.MaximumRetryAttempts, 2);
  assert.equal(invokeConfig.Properties.FunctionName.Ref, parser.id);
  assert.equal(invokeConfig.Properties.DestinationConfig, undefined, 'no on-failure destination');
});

test('T-INF-9 an EventBridge rule sends Object Created under uploads/ in the stage bucket to the parser', () => {
  const { api } = addStage(new cdk.App({ context }), 'qa', env);
  const all = resources(api);
  const parser = fnNamed(all, 'smart-finances-qa-parser');
  const rules = ofType(all, 'AWS::Events::Rule');
  assert.equal(rules.length, 1);
  const [, rule] = rules[0];
  const bucketName = parser.props.Environment.Variables.BUCKET_NAME;
  assert.equal(bucketName['Fn::GetAtt'][0], ofType(all, 'Custom::AWS')[0][0], 'the bucket name read from SSM');
  assert.deepEqual(rule.Properties.EventPattern, {
    source: ['aws.s3'],
    'detail-type': ['Object Created'],
    detail: { bucket: { name: [bucketName] }, object: { key: [{ prefix: 'uploads/' }] } },
  });
  assert.deepEqual(rule.Properties.Targets.map((t: any) => t.Arn['Fn::GetAtt'][0]), [parser.id]);
  const permissions = ofType(all, 'AWS::Lambda::Permission').filter(([, p]) => p.Properties.Principal === 'events.amazonaws.com');
  assert.equal(permissions.length, 1);
  assert.equal(permissions[0][1].Properties.FunctionName['Fn::GetAtt'][0], parser.id);
});

test('T-INF-9 grants: read only reads the table; write puts uploads and invokes only the parser and rollup; the parser reads and deletes uploads', () => {
  const { api } = addStage(new cdk.App({ context }), 'qa', env);
  const all = resources(api);
  const read = statementsOf(all, fnNamed(all, 'smart-finances-qa-api-read').roleId);
  const write = statementsOf(all, fnNamed(all, 'smart-finances-qa-api-write').roleId);
  const parser = fnNamed(all, 'smart-finances-qa-parser');
  const parse = statementsOf(all, parser.roleId);
  const logs = (s: Statement[]) => s.filter((x) => !actionsOf([x]).every((a) => a.startsWith('logs:')));
  assert.deepEqual(actionsOf(logs(read)), ['dynamodb:GetItem', 'dynamodb:Query']);
  assert.deepEqual(actionsOf(logs(write)), ['dynamodb:ConditionCheckItem', 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query', 'lambda:InvokeFunction', 's3:PutObject']);
  assert.deepEqual(actionsOf(logs(parse)), ['dynamodb:ConditionCheckItem', 'dynamodb:DeleteItem', 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query', 's3:DeleteObject', 's3:GetObject']);
  // Every non-log statement names exactly one resource.
  const resourcesFor = (statements: Statement[], action: string) => {
    const found = statements.filter((s) => actionsOf([s]).includes(action));
    assert.equal(found.length, 1, action);
    return Array.isArray(found[0].Resource) ? found[0].Resource : [found[0].Resource];
  };
  const only = (statements: Statement[], action: string) => {
    const list = resourcesFor(statements, action);
    assert.equal(list.length, 1, `${action} names one resource`);
    return JSON.stringify(list[0]);
  };
  const tableArn = only(read, 'dynamodb:Query');
  assert.match(tableArn, /:table\//);
  assert.doesNotMatch(tableArn, /index/);
  for (const [statements, action] of [[read, 'dynamodb:GetItem'], [write, 'dynamodb:PutItem'], [write, 'dynamodb:Query'], [parse, 'dynamodb:DeleteItem'], [parse, 'dynamodb:PutItem']] as const) {
    assert.equal(only(statements, action), tableArn, `${action} on the table only`);
  }
  for (const [statements, action] of [[write, 's3:PutObject'], [parse, 's3:GetObject'], [parse, 's3:DeleteObject']] as const) {
    assert.match(only(statements, action), /\/uploads\/\*"\]\]\}$/, `${action} on uploads/* only`);
  }
  const rollup = fnNamed(all, 'smart-finances-qa-rollup');
  assert.deepEqual(resourcesFor(write, 'lambda:InvokeFunction'), [{ 'Fn::GetAtt': [parser.id, 'Arn'] }, { 'Fn::GetAtt': [rollup.id, 'Arn'] }], 'invoke only the parser and rollup');
});

// ---- SF-50: the read, rollup and delete functions ----
test('T-INF-11 all 15 routes exist; every one but GET /health binds the JWT authorizer; each reaches its function', () => {
  for (const stage of STAGES) {
    const { api } = addStage(new cdk.App({ context }), stage, env);
    const all = resources(api);
    const [[authorizerId]] = ofType(all, 'AWS::ApiGatewayV2::Authorizer');
    const routes = ofType(all, 'AWS::ApiGatewayV2::Route').map(([, r]) => r);
    assert.equal(routes.length, 15);
    for (const route of routes) {
      const key = route.Properties.RouteKey;
      assert.ok(key in ALL_ROUTES, key);
      assert.equal(integrationTarget(all, route), fnNamed(all, `smart-finances-${stage}-${ALL_ROUTES[key]}`).id, key);
      if (key === 'GET /health') continue;
      assert.equal(route.Properties.AuthorizationType, 'JWT', key);
      assert.equal(route.Properties.AuthorizerId.Ref, authorizerId, key);
    }
  }
});

const STREAM_FILTERS = [
  { dynamodb: { Keys: { sk: { S: [{ prefix: 'TXN#' }] } } } },
  { dynamodb: { Keys: { sk: { S: [{ prefix: 'OVR#' }] } } } },
];

test('T-INF-12 rollup reads the table stream (TXN# and OVR# keys, batch 1,000 within 5 s, one at a time, bisect, 3 retries, 1 hour); failures go to a 14-day queue whose depth alarms a topic', () => {
  for (const stage of STAGES) {
    const { api } = addStage(new cdk.App({ context }), stage, env);
    const all = resources(api);
    const rollup = fnNamed(all, `smart-finances-${stage}-rollup`);
    assert.deepEqual([rollup.props.MemorySize, rollup.props.Timeout], [512, 60]);
    assert.deepEqual(Object.keys(rollup.props.Environment.Variables).sort(), ['STAGE', 'TABLE_NAME']);

    const mappings = ofType(all, 'AWS::Lambda::EventSourceMapping');
    assert.equal(mappings.length, 1);
    const mapping = mappings[0][1].Properties;
    const [[readerId]] = ofType(all, 'Custom::AWS');
    assert.equal(mapping.FunctionName.Ref, rollup.id);
    assert.deepEqual(mapping.EventSourceArn, { 'Fn::GetAtt': [readerId, 'Parameters.2.Value'] }, 'the stream ARN read from SSM');
    assert.equal(mapping.StartingPosition, 'TRIM_HORIZON');
    assert.equal(mapping.BatchSize, 1000);
    assert.equal(mapping.MaximumBatchingWindowInSeconds, 5);
    assert.equal(mapping.ParallelizationFactor, 1);
    assert.equal(mapping.BisectBatchOnFunctionError, true);
    assert.equal(mapping.MaximumRetryAttempts, 3);
    assert.equal(mapping.MaximumRecordAgeInSeconds, 3600);
    assert.deepEqual(mapping.FilterCriteria.Filters.map((f: { Pattern: string }) => JSON.parse(f.Pattern)), STREAM_FILTERS);

    const queues = ofType(all, 'AWS::SQS::Queue');
    assert.equal(queues.length, 1);
    const [[queueId, queue]] = queues;
    assert.equal(queue.Properties.MessageRetentionPeriod, 14 * 24 * 3600);
    assert.deepEqual(mapping.DestinationConfig, { OnFailure: { Destination: { 'Fn::GetAtt': [queueId, 'Arn'] } } });

    const topics = ofType(all, 'AWS::SNS::Topic');
    assert.equal(topics.length, 1);
    const [[topicId, topic]] = topics;
    assert.equal(topic.Properties.TopicName, `smart-finances-${stage}-rollup-failures`);
    assert.deepEqual(ofType(all, 'AWS::SNS::Subscription'), [], 'the owner subscribes an email by hand');

    const alarms = ofType(all, 'AWS::CloudWatch::Alarm');
    assert.equal(alarms.length, 1);
    const alarm = alarms[0][1].Properties;
    assert.deepEqual(
      [alarm.Namespace, alarm.MetricName, alarm.Statistic, alarm.Period, alarm.EvaluationPeriods, alarm.Threshold, alarm.ComparisonOperator, alarm.TreatMissingData],
      ['AWS/SQS', 'ApproximateNumberOfMessagesVisible', 'Maximum', 60, 1, 0, 'GreaterThanThreshold', 'notBreaching'],
    );
    assert.deepEqual(alarm.Dimensions, [{ Name: 'QueueName', Value: { 'Fn::GetAtt': [queueId, 'QueueName'] } }]);
    assert.deepEqual(alarm.AlarmActions, [{ Ref: topicId }]);
  }
});

test('T-INF-8 grants: rollup reads and writes the table, reads its stream, sends failures to its queue; api-delete reads and deletes one person\'s items and uploads', () => {
  const { api } = addStage(new cdk.App({ context }), 'qa', env);
  const all = resources(api);
  const [[readerId]] = ofType(all, 'Custom::AWS');
  const noLogs = (s: Statement[]) => s.filter((x) => !actionsOf([x]).every((a) => a.startsWith('logs:')));
  const rollup = noLogs(statementsOf(all, fnNamed(all, 'smart-finances-qa-rollup').roleId));
  const del = fnNamed(all, 'smart-finances-qa-api-delete');
  const erase = noLogs(statementsOf(all, del.roleId));
  const [[queueId]] = ofType(all, 'AWS::SQS::Queue');
  const tableArn = JSON.stringify(statementsOf(all, fnNamed(all, 'smart-finances-qa-api-read').roleId).find((s) => actionsOf([s]).includes('dynamodb:Query'))!.Resource);
  const byResource = (statements: Statement[]) =>
    Object.fromEntries(statements.map((s) => [JSON.stringify(s.Resource), { actions: actionsOf([s]), condition: s.Condition }]));

  const r = byResource(rollup);
  assert.deepEqual(Object.keys(r).length, rollup.length, 'one statement per resource');
  assert.deepEqual(r[tableArn].actions, ['dynamodb:ConditionCheckItem', 'dynamodb:PutItem', 'dynamodb:Query']);
  assert.deepEqual(r[JSON.stringify({ 'Fn::GetAtt': [readerId, 'Parameters.2.Value'] })].actions, ['dynamodb:DescribeStream', 'dynamodb:GetRecords', 'dynamodb:GetShardIterator']);
  assert.deepEqual(r['"*"'].actions, ['dynamodb:ListStreams']);
  assert.deepEqual(r[JSON.stringify({ 'Fn::GetAtt': [queueId, 'Arn'] })].actions, ['sqs:GetQueueAttributes', 'sqs:GetQueueUrl', 'sqs:SendMessage']);
  assert.equal(rollup.length, 4);

  assert.deepEqual([del.props.MemorySize, del.props.Timeout], [256, 25]);
  assert.deepEqual(Object.keys(del.props.Environment.Variables).sort(), ['BUCKET_NAME', 'STAGE', 'TABLE_NAME']);
  const d = byResource(erase);
  assert.equal(erase.length, 3);
  assert.deepEqual(d[tableArn].actions, ['dynamodb:DeleteItem', 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query']);
  const bucketName = del.props.Environment.Variables.BUCKET_NAME;
  const bucketArn = JSON.stringify({ 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':s3:::', bucketName]] });
  const uploadsArn = JSON.stringify({ 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':s3:::', bucketName, '/uploads/*']] });
  assert.deepEqual(d[bucketArn], { actions: ['s3:ListBucket'], condition: { StringLike: { 's3:prefix': 'uploads/*' } } });
  assert.deepEqual(d[uploadsArn], { actions: ['s3:DeleteObject'], condition: undefined });
});
