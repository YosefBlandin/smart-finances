import * as cdk from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import { apiAccessLogGroupName } from './api-stack';
import { readStageValues } from './stage-values';

/** Stages with a web stack, and so with alarms (dev has neither). */
const ALARM_STAGES = ['qa', 'staging', 'prod'];

/** Contracts "Security events": the web server's JSON log line names; one metric each. */
export const SECURITY_EVENTS = [
  'signup',
  'signup_confirm',
  'signin',
  'signin_fail',
  'mfa_setup',
  'reset',
  'signout',
  'account_delete',
  'rate_limited',
  'breached_password',
  'breach_check_unavailable',
  'health',
] as const;

/**
 * The functions each stage with a web stack runs, by makeFunction short name (named
 * smart-finances-<stage>-<name>): the API's health, the pool's two triggers, and the web stack's
 * housekeeping and branch-variables functions. Functions the data PRs add join this list.
 */
export const STAGE_FUNCTIONS = ['health', 'pre-sign-up', 'custom-message', 'housekeeping', 'amplify-vars'] as const;

export interface AlarmsStackProps extends cdk.StackProps {
  stage: string;
}

/**
 * One stage's alarms (D-80, Contracts "Alarms"): an SNS topic that emails alarm-email, the alarms,
 * and one dashboard with a widget per alarm. Security events are counted by metric filters on the
 * Amplify app's existing log group, /aws/amplify/<app id> (D-112); the heartbeat alarm breaches
 * when the hourly job's health line is missing for an hour (D-107). The qa stack alone creates
 * the account-wide monthly cost budget, at 50, 80 and 100% to its topic.
 *
 * Data API 429s are counted from the API stack's access log (by its fixed name), since HTTP APIs
 * publish no throttle metric; that log group must exist before this stack deploys.
 *
 * Values are read from SSM at deploy time (D-33): alarm-email, amplify-app-id, api-url (the HTTP
 * API's id is its host's first label) and, on qa, monthly-budget-usd. A missing one fails the
 * deploy. Functions are found by their fixed names, so no other stack is referenced.
 */
export class AlarmsStack extends cdk.Stack {
  readonly stage: string;
  readonly topic: sns.Topic;
  readonly dashboard: cloudwatch.Dashboard;
  readonly alarms: cloudwatch.Alarm[] = [];

  constructor(scope: Construct, id: string, props: AlarmsStackProps) {
    super(scope, id, props);
    if (!ALARM_STAGES.includes(props.stage)) throw new Error(`AlarmsStack: no alarms stack for stage ${props.stage}`);
    this.stage = props.stage;
    const stage = props.stage;
    const withBudget = stage === 'qa';

    const names = ['alarm-email', 'amplify-app-id', 'api-url', ...(withBudget ? ['monthly-budget-usd'] : [])];
    const values = readStageValues(this, stage, names) as Record<string, string>;
    const appId = values['amplify-app-id'];
    // https://<api id>.execute-api.<region>.amazonaws.com
    const apiId = cdk.Fn.select(2, cdk.Fn.split('/', cdk.Fn.select(0, cdk.Fn.split('.', values['api-url']))));

    this.topic = new sns.Topic(this, 'AlarmTopic', { topicName: `smart-finances-${stage}-alarms` });
    this.topic.addSubscription(new subscriptions.EmailSubscription(values['alarm-email']));
    const toTopic = new actions.SnsAction(this.topic);

    const namespace = `SmartFinances/${stage}`;
    const five = cdk.Duration.minutes(5);
    const hour = cdk.Duration.hours(1);

    // One metric per security event name, counted from the web server's JSON lines. No default
    // value: an hour without a health line is missing data, which the heartbeat treats as breaching.
    const logGroup = logs.LogGroup.fromLogGroupName(this, 'AmplifyLogs', `/aws/amplify/${appId}`);
    const eventMetric = (event: string, period: cdk.Duration) =>
      new cloudwatch.Metric({ namespace, metricName: event, statistic: 'Sum', period });
    for (const event of SECURITY_EVENTS) {
      new logs.MetricFilter(this, `Event${event.replace(/(^|_)([a-z])/g, (_, __, c: string) => c.toUpperCase())}`, {
        logGroup,
        filterPattern: logs.FilterPattern.stringValue('$.event', '=', event),
        metricNamespace: namespace,
        metricName: event,
        metricValue: '1',
      });
    }

    const add = (
      slug: string,
      description: string,
      metric: cloudwatch.IMetric,
      threshold: number,
      options: { op?: cloudwatch.ComparisonOperator; periods?: number; missing?: cloudwatch.TreatMissingData } = {},
    ) => {
      const id = slug.replace(/(^|-)([a-z])/g, (_, __, c: string) => c.toUpperCase());
      const alarm = new cloudwatch.Alarm(this, `${id}Alarm`, {
        alarmName: `smart-finances-${stage}-${slug}`,
        alarmDescription: description,
        metric,
        threshold,
        evaluationPeriods: options.periods ?? 1,
        comparisonOperator: options.op ?? cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: options.missing ?? cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarm.addAlarmAction(toTopic);
      this.alarms.push(alarm);
    };

    add('signup-spike', 'Over 50 sign-ups in 1 hour', eventMetric('signup', hour), 50);
    add('signin-failures', 'Over 100 failed sign-ins in 15 minutes', eventMetric('signin_fail', cdk.Duration.minutes(15)), 100);
    add('rate-limit-refusals', 'Over 500 rate-limit refusals in 5 minutes', eventMetric('rate_limited', five), 500);

    add(
      'web-server-errors',
      'Web server 5xx over 2% for 10 minutes',
      new cloudwatch.MathExpression({
        expression: '100 * errors / requests',
        label: 'Web server 5xx %',
        period: five,
        usingMetrics: {
          errors: new cloudwatch.Metric({ namespace: 'AWS/AmplifyHosting', metricName: '5xxErrors', dimensionsMap: { App: appId }, statistic: 'Sum', period: five }),
          requests: new cloudwatch.Metric({ namespace: 'AWS/AmplifyHosting', metricName: 'Requests', dimensionsMap: { App: appId }, statistic: 'Sum', period: five }),
        },
      }),
      2,
      { periods: 2 },
    );

    add(
      'api-errors',
      'Data API 5xx over 2% in 5 minutes',
      new cloudwatch.MathExpression({
        expression: '100 * errors / requests',
        label: 'Data API 5xx %',
        period: five,
        usingMetrics: {
          errors: new cloudwatch.Metric({ namespace: 'AWS/ApiGateway', metricName: '5xx', dimensionsMap: { ApiId: apiId }, statistic: 'Sum', period: five }),
          requests: new cloudwatch.Metric({ namespace: 'AWS/ApiGateway', metricName: 'Count', dimensionsMap: { ApiId: apiId }, statistic: 'Sum', period: five }),
        },
      }),
      2,
    );

    // HTTP APIs publish no 429 metric, so the API stack's access log is counted instead.
    new logs.MetricFilter(this, 'Api429', {
      logGroup: logs.LogGroup.fromLogGroupName(this, 'ApiAccessLogs', apiAccessLogGroupName(stage)),
      filterPattern: logs.FilterPattern.stringValue('$.status', '=', '429'),
      metricNamespace: namespace,
      metricName: 'Api429',
      metricValue: '1',
    });
    add('api-throttles', 'Any data API 429 in 5 minutes', new cloudwatch.Metric({ namespace, metricName: 'Api429', statistic: 'Sum', period: five }), 0);

    for (const fn of STAGE_FUNCTIONS) {
      const functionName = `smart-finances-${stage}-${fn}`;
      const lambdaMetric = (metricName: string) =>
        new cloudwatch.Metric({ namespace: 'AWS/Lambda', metricName, dimensionsMap: { FunctionName: functionName }, statistic: 'Sum', period: five });
      add(
        `function-errors-${fn}`,
        `Any error or throttle of ${functionName} in 5 minutes`,
        new cloudwatch.MathExpression({
          expression: 'errors + throttles',
          label: `${fn} errors and throttles`,
          period: five,
          usingMetrics: { errors: lambdaMetric('Errors'), throttles: lambdaMetric('Throttles') },
        }),
        0,
      );
    }

    add('log-heartbeat', 'No health line from the hourly job for 1 hour (missing data breaches)', eventMetric('health', hour), 1, {
      op: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      missing: cloudwatch.TreatMissingData.BREACHING,
    });
    add(
      'stuck-deletion',
      'An account deleting for over 6 hours',
      new cloudwatch.Metric({ namespace, metricName: 'StuckDeletions', statistic: 'Maximum', period: hour }),
      0,
    );

    const ses = (metricName: string) => new cloudwatch.Metric({ namespace: 'AWS/SES', metricName, statistic: 'Maximum', period: five });
    add('ses-bounce-rate', 'Email bounce rate over 5%', ses('Reputation.BounceRate'), 0.05);
    add('ses-complaint-rate', 'Email complaint rate over 0.1%', ses('Reputation.ComplaintRate'), 0.001);

    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', { dashboardName: `smart-finances-${stage}` });
    this.dashboard.addWidgets(...this.alarms.map((alarm) => new cloudwatch.AlarmWidget({ alarm, title: alarm.alarmName, width: 8 })));

    if (withBudget) this.addBudget(values['monthly-budget-usd']);
  }

  /** The account's monthly cost budget, created by qa alone: actual spend over 50, 80 and 100% emails the topic. */
  private addBudget(amount: string) {
    this.topic.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal('budgets.amazonaws.com')],
        actions: ['sns:Publish'],
        resources: [this.topic.topicArn],
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      }),
    );
    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: 'smart-finances-monthly',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: cdk.Token.asNumber(amount), unit: 'USD' },
      },
      notificationsWithSubscribers: [50, 80, 100].map((threshold) => ({
        notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold, thresholdType: 'PERCENTAGE' },
        subscribers: [{ subscriptionType: 'SNS', address: this.topic.topicArn }],
      })),
    });
  }
}
