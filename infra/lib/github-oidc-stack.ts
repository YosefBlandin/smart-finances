import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface GithubOidcStackProps extends cdk.StackProps {
  githubOwner: string;
  githubRepo: string;
  allowedBranches: string[];
  /**
   * Stages whose Amplify app CI may release (D-113). Each needs /smart-finances/<stage>/amplify-app-id set before
   * this stack deploys, because the app id is read at deploy time. Defaults to the `amplifyStages` context value
   * (comma-separated, e.g. `-c amplifyStages=qa,staging,prod`), else qa only, the one stage whose id exists so far.
   */
  amplifyStages?: string[];
}

/** Stage to Amplify branch (Values: qa to qa, staging to staging, prod to main). */
export const AMPLIFY_BRANCH: Record<string, string> = { qa: 'qa', staging: 'staging', prod: 'main' };

/** Everything runs in us-east-1 (D-89): the Amplify app and the stage parameters live there. */
const RELEASE_REGION = 'us-east-1';

/**
 * Lets GitHub Actions deploy without stored AWS keys.
 *
 * Trust: only workflows in <owner>/<repo> on the allowed branches can assume the role.
 * Permissions: the role can assume the CDK bootstrap roles. Those roles, not this one, hold
 * the permissions to create resources, so the CI role itself stays tiny. For the release
 * step (scripts/amplify-release.mjs, D-93, D-113) it may also read each stage's
 * amplify-app-id parameter and start, get and list jobs on that stage's Amplify branch only.
 */
export class GithubOidcStack extends cdk.Stack {
  public readonly deployRole: iam.Role;

  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

    const provider = new iam.OidcProviderNative(this, 'GithubProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    const repo = `${props.githubOwner}/${props.githubRepo}`;
    const subjects = props.allowedBranches.map((b) => `repo:${repo}:ref:refs/heads/${b}`);

    this.deployRole = new iam.Role(this, 'DeployRole', {
      roleName: 'smart-finances-github-deploy',
      description: `Assumed by GitHub Actions in ${repo} to run cdk deploy`,
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.oidcProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          'token.actions.githubusercontent.com:sub': subjects,
        },
      }),
    });

    // CDK v2 default bootstrap qualifier is "hnb659fds".
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkBootstrapRoles',
        actions: ['sts:AssumeRole'],
        resources: [`arn:${this.partition}:iam::${this.account}:role/cdk-hnb659fds-*`],
      }),
    );

    const stages = props.amplifyStages ?? amplifyStagesFromContext(this);
    for (const stage of stages) {
      if (!(stage in AMPLIFY_BRANCH)) throw new Error(`amplifyStages: unknown stage ${stage}`);
    }

    // Read of the amplify-app-id parameters (the release script's first call).
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadAmplifyAppIds',
        actions: ['ssm:GetParameter'],
        resources: Object.keys(AMPLIFY_BRANCH).map(
          (stage) => `arn:${this.partition}:ssm:${RELEASE_REGION}:${this.account}:parameter/smart-finances/${stage}/amplify-app-id`,
        ),
      }),
    );

    // Start, get and list jobs on each stage's app and branch only. The app id is resolved from the parameter
    // when this stack deploys, so it must be redeployed when a stage's app id is set or changes.
    if (stages.length > 0) {
      const resources = stages.flatMap((stage) => {
        const appId = ssm.StringParameter.valueForStringParameter(this, `/smart-finances/${stage}/amplify-app-id`);
        const branch = `arn:${this.partition}:amplify:${RELEASE_REGION}:${this.account}:apps/${appId}/branches/${AMPLIFY_BRANCH[stage]}`;
        return [branch, `${branch}/jobs/*`];
      });
      this.deployRole.addToPolicy(
        new iam.PolicyStatement({
          sid: 'ReleaseAmplifyJobs',
          actions: ['amplify:StartJob', 'amplify:GetJob', 'amplify:ListJobs'],
          resources,
        }),
      );
    }

    new cdk.CfnOutput(this, 'DeployRoleArn', {
      value: this.deployRole.roleArn,
      description: 'Set as the AWS_DEPLOY_ROLE_ARN repository variable in GitHub',
    });
  }
}

function amplifyStagesFromContext(scope: Construct): string[] {
  const raw: unknown = scope.node.tryGetContext('amplifyStages');
  if (raw === undefined) return ['qa'];
  const list = Array.isArray(raw) ? raw.map(String) : String(raw).split(',');
  return list.map((s) => s.trim()).filter(Boolean);
}
