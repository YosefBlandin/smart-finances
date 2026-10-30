import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

/**
 * Reads values the data stack published under /smart-finances/<stage>/ (D-33).
 *
 * Not SSM-typed template parameters: CloudFormation resolves those with the CDK deploy role,
 * which may read only the bootstrap version. One custom resource calls SSM GetParameters
 * instead, with a role scoped to exactly these parameter ARNs, and its physical id changes on
 * every synth so each deploy reads the current values. Like every function here, it gets its own
 * role (no managed policies, so no "*") and a one-month log group.
 *
 * GetParameters answers in name order, not request order, so names are requested sorted and
 * Parameters.<i> is the i-th sorted name either way. A missing parameter fails the deploy,
 * because the last index is then absent.
 */
export function readStageValues<N extends string>(scope: Construct, stage: string, names: readonly N[]): Record<N, string> {
  const stack = cdk.Stack.of(scope);
  const sorted = [...names].sort();
  const path = (name: string) => `/smart-finances/${stage}/${name}`;

  const call: cr.AwsSdkCall = {
    service: 'SSM',
    action: 'getParameters',
    parameters: { Names: sorted.map(path) },
    physicalResourceId: cr.PhysicalResourceId.of(`stage-values-${Date.now()}`),
    outputPaths: sorted.map((_, i) => `Parameters.${i}.Value`),
  };
  const logGroup = new logs.LogGroup(scope, 'StageValuesLogs', {
    retention: logs.RetentionDays.ONE_MONTH,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
  });
  const role = new iam.Role(scope, 'StageValuesRole', {
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  });
  logGroup.grantWrite(role);

  const reader = new cr.AwsCustomResource(scope, 'StageValues', {
    role,
    logGroup,
    onCreate: call,
    onUpdate: call,
    installLatestAwsSdk: false,
    policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
      resources: sorted.map((name) =>
        stack.formatArn({ service: 'ssm', resource: 'parameter', resourceName: path(name).slice(1), arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME }),
      ),
    }),
  });

  return Object.fromEntries(sorted.map((name, i) => [name, reader.getResponseField(`Parameters.${i}.Value`)])) as Record<N, string>;
}
