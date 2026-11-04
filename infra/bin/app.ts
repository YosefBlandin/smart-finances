import * as cdk from 'aws-cdk-lib';
import { GithubOidcStack } from '../lib/github-oidc-stack';
import { addStage } from '../lib/stage';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

// Account-level, deployed once by hand with the "personal" profile.
// After that, GitHub Actions deploys with short-lived OIDC credentials.
new GithubOidcStack(app, 'smart-finances-github-oidc', {
  env,
  githubOwner: 'YosefBlandin',
  githubRepo: 'smart-finances',
  // Only these branches may assume the deploy role.
  allowedBranches: ['main', 'staging', 'qa'],
});

// Per-stage stacks, deployed in this order: data, API, web, alarms (D-89); dev (local) has only
// data and API, qa, staging and prod have all four. addStage pins them to us-east-1.
const stage = app.node.tryGetContext('stage') ?? 'dev';
addStage(app, stage, env);
