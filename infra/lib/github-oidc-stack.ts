import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface GithubOidcStackProps extends cdk.StackProps {
  githubOwner: string;
  githubRepo: string;
  allowedBranches: string[];
}

/**
 * Lets GitHub Actions deploy without stored AWS keys.
 *
 * Trust: only workflows in <owner>/<repo> on the allowed branches can assume the role.
 * Permissions: the role can only assume the CDK bootstrap roles. Those roles, not this
 * one, hold the permissions to create resources, so the CI role itself stays tiny.
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

    new cdk.CfnOutput(this, 'DeployRoleArn', {
      value: this.deployRole.roleArn,
      description: 'Set as the AWS_DEPLOY_ROLE_ARN repository variable in GitHub',
    });
  }
}
