import * as cdk from 'aws-cdk-lib';
import { ApiStack } from './api-stack';
import { DataStack } from './data-stack';

/**
 * One stage = a data stack and an API stack. The data stack deploys first; the API stack reads
 * its values from SSM, so there are no CloudFormation exports to block either deploy.
 * Web origins per stage come from the webOrigins context map in cdk.json (none by default).
 */
export function addStage(app: cdk.App, stage: string, env?: cdk.Environment) {
  const origins = (app.node.tryGetContext('webOrigins') ?? {}) as Record<string, string[]>;
  const webOrigins = origins[stage] ?? [];

  const data = new DataStack(app, `smart-finances-data-${stage}`, { env, stage, webOrigins });
  const api = new ApiStack(app, `smart-finances-api-${stage}`, { env, stage, webOrigins });
  api.addStackDependency(data);
  return { data, api };
}
