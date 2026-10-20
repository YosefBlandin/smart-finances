import * as cdk from 'aws-cdk-lib';
import { GithubOidcStack } from '../lib/github-oidc-stack';
import { ApiStack } from '../lib/api-stack';

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

// Per-stage application stack: dev (local), qa, staging, prod.
const stage = app.node.tryGetContext('stage') ?? 'dev';
new ApiStack(app, `smart-finances-api-${stage}`, { env, stage });
