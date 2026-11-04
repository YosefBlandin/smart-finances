// The hourly housekeeping job of a stage's web stack (D-104, D-106, D-107; architecture.md "Web
// stack", Contracts "Accounts table", "Sessions table", "Alarms").
//
// 1. Unconfirmed sign-ups (D-106): list the pool's UNCONFIRMED users and delete those created more
//    than 24 hours ago. This job alone may list users.
// 2. Stuck account deletions (D-104): every accounts row with status deleting is finished in
//    D-104's order: erase through the data service's delete function (invoked with { sub }), sign
//    out everywhere, delete the pool user (not found is done), remove the person's session rows,
//    then the accounts row (only while it is still deleting). A step runs only after the one before
//    it is done, so a failed step leaves the rest for the next hour. The delete function is named
//    by the delete-function-name stage parameter, which may not exist yet (data PR 3): then the
//    erase is skipped and counted, and nothing else of that person is removed, because removing the
//    pool user and the rows first would leave their data with no way to erase it. Rows still
//    deleting more than 6 hours after deleting_since (or with no deleting_since) are put as the
//    StuckDeletions metric, which alarms.
// 3. Heartbeat (D-107): one GET of the branch's /api/health, so the web server writes its health
//    line every hour.
//
// Each part runs even when another fails; a failure is recorded and the run then throws, so the
// function's errors alarm. The metric is an Embedded Metric Format log line (no CloudWatch client
// or grant). Nothing logged names a person: no email, sub or username, only counts, step names and
// error names.
import {
  AdminDeleteUserCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DeleteItemCommand, DynamoDBClient, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const HOUR_MS = 3_600_000;
export const UNCONFIRMED_MAX_AGE_MS = 24 * HOUR_MS;
export const STUCK_AFTER_MS = 6 * HOUR_MS;
export const HEALTH_TIMEOUT_MS = 10_000;
/** Logged in place of the function name while delete-function-name does not exist. */
export const DELETE_FUNCTION_NOT_SET = 'not-set';

const ACCOUNT_PREFIX = 'ACCT#';
const errorName = (error) => (typeof error?.name === 'string' && error.name) || 'Error';
const isName = (error, name) => error?.name === name;

/** A step that failed with an error name of its own (an erase answered FunctionError). */
class StepError extends Error {
  constructor(step, name) {
    super(`${step} failed: ${name}`);
    this.step = step;
    this.name = name;
  }
}

/**
 * @param {{
 *   cognito: { send(command: unknown): Promise<any> },
 *   dynamodb: { send(command: unknown): Promise<any> },
 *   lambda: { send(command: unknown): Promise<any> },
 *   ssm: { send(command: unknown): Promise<any> },
 *   fetch: typeof globalThis.fetch,
 *   now?: () => number,
 *   log?: (line: string) => void,
 *   config: { stage: string, userPoolId: string, sessionsTable: string, accountsTable: string, healthUrl: string, deleteFunctionParameter: string },
 * }} deps
 */
export function makeHandler({ cognito, dynamodb, lambda, ssm, fetch, now = Date.now, log = (line) => console.log(line), config }) {
  for (const key of ['stage', 'userPoolId', 'sessionsTable', 'accountsTable', 'healthUrl', 'deleteFunctionParameter']) {
    if (typeof config?.[key] !== 'string' || !config[key]) throw new Error(`housekeeping needs ${key}`);
  }
  const { userPoolId, sessionsTable, accountsTable } = config;

  async function removeUnconfirmed(at, failures) {
    let removed = 0;
    let token;
    do {
      const page = await cognito.send(
        new ListUsersCommand({
          UserPoolId: userPoolId,
          Filter: 'cognito:user_status = "UNCONFIRMED"',
          // Only the sub: the job never loads an email.
          AttributesToGet: ['sub'],
          PaginationToken: token,
        }),
      );
      for (const user of page.Users ?? []) {
        // The filter is the pool's; the status and age are checked here too.
        if (user.UserStatus !== 'UNCONFIRMED' || !user.Username) continue;
        const created = user.UserCreateDate instanceof Date ? user.UserCreateDate.getTime() : Date.parse(user.UserCreateDate);
        if (!Number.isFinite(created) || at - created <= UNCONFIRMED_MAX_AGE_MS) continue;
        try {
          await cognito.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: user.Username }));
          removed += 1;
        } catch (error) {
          if (isName(error, 'UserNotFoundException')) removed += 1;
          else failures.push({ step: 'remove_unconfirmed', error: errorName(error) });
        }
      }
      token = page.PaginationToken;
    } while (token);
    return removed;
  }

  /** The delete function's name, or undefined while the parameter does not exist or is empty. */
  async function deleteFunctionName() {
    try {
      const out = await ssm.send(new GetParameterCommand({ Name: config.deleteFunctionParameter }));
      const value = out.Parameter?.Value?.trim();
      return value || undefined;
    } catch (error) {
      if (isName(error, 'ParameterNotFound')) return undefined;
      throw error;
    }
  }

  async function deletingRows() {
    const rows = [];
    let start;
    do {
      const page = await dynamodb.send(
        new ScanCommand({
          TableName: accountsTable,
          FilterExpression: '#status = :deleting',
          ProjectionExpression: 'pk, #status, deleting_since',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':deleting': { S: 'deleting' } },
          ExclusiveStartKey: start,
        }),
      );
      for (const item of page.Items ?? []) {
        const pk = item.pk?.S;
        if (!pk?.startsWith(ACCOUNT_PREFIX) || item.status?.S !== 'deleting') continue;
        const sub = pk.slice(ACCOUNT_PREFIX.length);
        if (!sub) continue;
        rows.push({ pk, sub, since: item.deleting_since?.S });
      }
      start = page.LastEvaluatedKey;
    } while (start);
    return rows;
  }

  const ignoring = async (promise, name) => {
    try {
      await promise;
    } catch (error) {
      if (!isName(error, name)) throw error;
    }
  };

  /** D-104's steps for one person, in order; throws at the first step that fails. */
  async function finish({ pk, sub }, functionName) {
    let step = 'erase';
    try {
      const out = await lambda.send(
        new InvokeCommand({
          FunctionName: functionName,
          InvocationType: 'RequestResponse',
          Payload: Buffer.from(JSON.stringify({ sub })),
        }),
      );
      if (out.FunctionError) throw new StepError(step, out.FunctionError);
      if (out.StatusCode !== undefined && out.StatusCode !== 200) throw new StepError(step, `Status${out.StatusCode}`);

      step = 'sign_out';
      await ignoring(cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId: userPoolId, Username: sub })), 'UserNotFoundException');

      step = 'delete_user';
      await ignoring(cognito.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: sub })), 'UserNotFoundException');

      step = 'remove_sessions';
      let start;
      do {
        const page = await dynamodb.send(
          new QueryCommand({
            TableName: sessionsTable,
            IndexName: 'bySub',
            KeyConditionExpression: '#sub = :sub',
            ExpressionAttributeNames: { '#sub': 'sub' },
            ExpressionAttributeValues: { ':sub': { S: sub } },
            ExclusiveStartKey: start,
          }),
        );
        for (const item of page.Items ?? []) {
          if (item.pk?.S) await dynamodb.send(new DeleteItemCommand({ TableName: sessionsTable, Key: { pk: { S: item.pk.S } } }));
        }
        start = page.LastEvaluatedKey;
      } while (start);

      step = 'remove_account';
      await ignoring(
        dynamodb.send(
          new DeleteItemCommand({
            TableName: accountsTable,
            Key: { pk: { S: pk } },
            ConditionExpression: '#status = :deleting',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':deleting': { S: 'deleting' } },
          }),
        ),
        'ConditionalCheckFailedException',
      );
    } catch (error) {
      if (error instanceof StepError) throw error;
      throw new StepError(step, errorName(error));
    }
  }

  const isStuck = (row, at) => {
    const since = row.since ? Date.parse(row.since) : NaN;
    return !Number.isFinite(since) || at - since > STUCK_AFTER_MS;
  };

  async function finishDeletions(at, failures) {
    const result = { finished: 0, eraseSkipped: 0, stuck: undefined, functionName: DELETE_FUNCTION_NOT_SET };
    let rows;
    try {
      rows = await deletingRows();
    } catch (error) {
      failures.push({ step: 'find_deletions', error: errorName(error) });
      return result;
    }

    let functionName;
    let functionKnown = true;
    if (rows.length > 0) {
      try {
        functionName = await deleteFunctionName();
      } catch (error) {
        functionKnown = false;
        failures.push({ step: 'delete_function_name', error: errorName(error) });
      }
    }
    if (functionName) result.functionName = functionName;

    let stuck = 0;
    for (const row of rows) {
      if (!functionName) {
        if (functionKnown) result.eraseSkipped += 1;
        if (isStuck(row, at)) stuck += 1;
        continue;
      }
      try {
        await finish(row, functionName);
        result.finished += 1;
      } catch (error) {
        failures.push({ step: error.step ?? 'finish', error: errorName(error) });
        if (isStuck(row, at)) stuck += 1;
      }
    }
    result.stuck = stuck;
    return result;
  }

  async function heartbeat(failures) {
    try {
      const res = await fetch(config.healthUrl, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      if (!res.ok) failures.push({ step: 'health', error: `Status${res.status}` });
      return res.status;
    } catch (error) {
      failures.push({ step: 'health', error: errorName(error) });
      return null;
    }
  }

  return async function handler() {
    const at = now();
    const failures = [];

    let unconfirmedRemoved = 0;
    try {
      unconfirmedRemoved = await removeUnconfirmed(at, failures);
    } catch (error) {
      failures.push({ step: 'list_unconfirmed', error: errorName(error) });
    }

    const deletions = await finishDeletions(at, failures);
    const health = await heartbeat(failures);

    // StuckDeletions every run (zero too), so the alarm sees data; none when the scan failed.
    if (deletions.stuck !== undefined) {
      log(
        JSON.stringify({
          _aws: {
            Timestamp: at,
            CloudWatchMetrics: [{ Namespace: `SmartFinances/${config.stage}`, Dimensions: [[]], Metrics: [{ Name: 'StuckDeletions', Unit: 'Count' }] }],
          },
          StuckDeletions: deletions.stuck,
        }),
      );
    }

    const summary = {
      event: 'housekeeping',
      unconfirmedRemoved,
      deletionsFinished: deletions.finished,
      eraseSkipped: deletions.eraseSkipped,
      stuckDeletions: deletions.stuck ?? null,
      deleteFunction: deletions.functionName,
      health,
      failures,
      ts: new Date(at).toISOString(),
    };
    log(JSON.stringify(summary));

    if (failures.length > 0) throw new Error(`housekeeping: ${failures.length} step(s) failed`);
    return summary;
  };
}

function fromEnvironment() {
  const env = process.env;
  return makeHandler({
    cognito: new CognitoIdentityProviderClient({}),
    dynamodb: new DynamoDBClient({}),
    lambda: new LambdaClient({}),
    ssm: new SSMClient({}),
    fetch: globalThis.fetch,
    config: {
      stage: env.STAGE,
      userPoolId: env.USER_POOL_ID,
      sessionsTable: env.SESSIONS_TABLE,
      accountsTable: env.ACCOUNTS_TABLE,
      healthUrl: env.HEALTH_URL,
      deleteFunctionParameter: env.DELETE_FUNCTION_PARAMETER,
    },
  });
}

let defaultHandler;
/** The function's entry point: clients and settings from the Lambda environment, built on first use. */
export const handler = (event) => (defaultHandler ??= fromEnvironment())(event);
