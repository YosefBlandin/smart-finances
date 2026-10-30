import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

const repoRoot = path.join(__dirname, '../..');

export interface FunctionOptions {
  /** Short name; the function is called smart-finances-<stage>-<name>, which release scripts rely on. */
  name: string;
  /** Handler file, relative to the repo root, exporting `handler`. */
  entry: string;
  memoryMb: number;
  timeoutSeconds: number;
  environment?: Record<string, string>;
}

/**
 * One Lambda function as this repo builds them: Node 22, bundled by esbuild with the AWS SDK
 * pinned in apps/api, its own role whose only permission is writing to its own one-month log
 * group. Callers grant table, bucket and invoke rights on that role, scoped to resources.
 * The scope's stack must have a `stage`.
 */
export function makeFunction(scope: Construct, options: FunctionOptions): NodejsFunction {
  const stage = (cdk.Stack.of(scope) as cdk.Stack & { stage?: string }).stage;
  if (!stage) throw new Error('makeFunction needs a stack with a stage');
  const id = options.name.replace(/(^|-)([a-z])/g, (_, __, c: string) => c.toUpperCase());

  const logGroup = new logs.LogGroup(scope, `${id}Logs`, {
    retention: logs.RetentionDays.ONE_MONTH,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
  });
  const role = new iam.Role(scope, `${id}Role`, {
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  });
  logGroup.grantWrite(role);

  // Off by default: new AWS accounts start with a Lambda concurrency quota of 10 and AWS
  // requires 10 to stay unreserved, so no reservation is possible until the quota is raised.
  // Enable later with: cdk deploy -c reservedConcurrency=5
  const reservedRaw = scope.node.tryGetContext('reservedConcurrency');
  const reservedConcurrency = reservedRaw === undefined ? undefined : Number(reservedRaw);

  return new NodejsFunction(scope, id, {
    functionName: `smart-finances-${stage}-${options.name}`,
    entry: path.join(repoRoot, options.entry),
    handler: 'handler',
    runtime: lambda.Runtime.NODEJS_22_X,
    projectRoot: repoRoot,
    depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
    bundling: {
      format: OutputFormat.ESM,
      target: 'node22',
      minify: true,
      // D-20: the SDK versions pinned in apps/api go into the bundle, not the runtime's copy.
      bundleAwsSDK: true,
      // Some bundled CommonJS code calls require; ESM output needs it defined.
      banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
    },
    role,
    logGroup,
    memorySize: options.memoryMb,
    timeout: cdk.Duration.seconds(options.timeoutSeconds),
    reservedConcurrentExecutions: reservedConcurrency,
    environment: { STAGE: stage, ...options.environment },
  });
}
