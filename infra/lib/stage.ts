import * as cdk from 'aws-cdk-lib';
import { AlarmsStack } from './alarms-stack';
import { ApiStack } from './api-stack';
import { DataStack } from './data-stack';
import { WebStack } from './web-stack';

/** Every stage runs in us-east-1, where the stacks already are (D-89). */
export const STAGE_REGION = 'us-east-1';

/** Stages with a web server, and so with web and alarms stacks; dev has neither. */
const WEB_STAGES = ['qa', 'staging', 'prod'];

/**
 * One stage = data, API, web and alarms stacks, deployed in that order in us-east-1 (D-89); dev
 * gets only data and API. Each stack reads the values it needs from SSM at deploy time (D-33),
 * so there are no CloudFormation exports, and each depends on the one before it so that every
 * parameter it reads is already written: the API reads the data stack's names; the web stack
 * reads those and the API's api-url; the alarms stack reads api-url and filters the API's access
 * log. amplify-app-id, support-address, alarm-email and monthly-budget-usd are set by a person.
 * Web origins per stage come from the webOrigins context map in cdk.json (none by default); they
 * reach the upload bucket's browser rule through the web stack (D-88).
 */
export function addStage(app: cdk.App, stage: string, env?: cdk.Environment) {
  const origins = (app.node.tryGetContext('webOrigins') ?? {}) as Record<string, string[]>;
  const webOrigins = origins[stage] ?? [];
  const stageEnv: cdk.Environment = { ...env, region: STAGE_REGION };

  const data = new DataStack(app, `smart-finances-data-${stage}`, { env: stageEnv, stage, webOrigins });
  const api = new ApiStack(app, `smart-finances-api-${stage}`, { env: stageEnv, stage, webOrigins });
  api.addStackDependency(data);
  if (!WEB_STAGES.includes(stage)) return { data, api, web: undefined, alarms: undefined };

  const web = new WebStack(app, `smart-finances-web-${stage}`, { env: stageEnv, stage, webOrigins });
  web.addStackDependency(api);
  const alarms = new AlarmsStack(app, `smart-finances-alarms-${stage}`, { env: stageEnv, stage });
  alarms.addStackDependency(web);
  return { data, api, web, alarms };
}
