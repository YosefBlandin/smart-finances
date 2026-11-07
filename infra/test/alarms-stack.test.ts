import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AlarmsStack, SECURITY_EVENTS, STAGE_FUNCTIONS } from '../lib/alarms-stack';
import { apiAccessLogGroupName } from '../lib/api-stack';

const env = { account: '111111111111', region: 'us-east-1' };
const STAGES = ['qa', 'staging', 'prod'];

type Resource = { Type: string; Properties: Record<string, any> };

function synth(stage: string) {
  const app = new cdk.App();
  const stack = new AlarmsStack(app, `smart-finances-alarms-${stage}`, { env, stage });
  const json = Template.fromStack(stack).toJSON();
  return { stack, json, resources: json.Resources as Record<string, Resource> };
}

const ofType = (all: Record<string, Resource>, type: string) => Object.entries(all).filter(([, r]) => r.Type === type);

/** The stage values the stack reads, keyed by the custom resource attribute that answers each. */
function stageValueNames(all: Record<string, Resource>, stage: string): Map<string, string> {
  const readers = ofType(all, 'Custom::AWS').filter(([id]) => id.startsWith('StageValues'));
  assert.equal(readers.length, 1, 'one stage values reader');
  const call = JSON.parse(readers[0][1].Properties.Create);
  assert.equal(call.action, 'getParameters');
  const byAttribute = new Map<string, string>();
  (call.parameters.Names as string[]).forEach((name, i) => {
    assert.ok(name.startsWith(`/smart-finances/${stage}/`), name);
    byAttribute.set(`${readers[0][0]}.Parameters.${i}.Value`, name.slice(`/smart-finances/${stage}/`.length));
  });
  return byAttribute;
}

/** Renders a template value as a readable string: {{name}} for a stage value, {{Ref:X}} and {{X.Attr}} otherwise. */
function flat(value: any, names: Map<string, string>): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value?.Ref === 'AWS::Partition') return 'aws';
  if (value?.Ref === 'AWS::Region') return 'us-east-1';
  if (value?.Ref === 'AWS::AccountId') return '111111111111';
  if (value?.Ref) return `{{Ref:${value.Ref}}}`;
  if (value?.['Fn::GetAtt']) {
    const key = value['Fn::GetAtt'].join('.');
    return names.has(key) ? `{{${names.get(key)}}}` : `{{${key}}}`;
  }
  if (value?.['Fn::Join']) return value['Fn::Join'][1].map((v: any) => flat(v, names)).join(value['Fn::Join'][0]);
  if (value?.['Fn::Select']) {
    const [i, list] = value['Fn::Select'];
    if (list?.['Fn::Split']) return `select(${i},split(${list['Fn::Split'][0]},${flat(list['Fn::Split'][1], names)}))`;
  }
  throw new Error(`cannot flatten ${JSON.stringify(value)}`);
}

/** A single-metric alarm's metric, or each metric of a math alarm, as "namespace/name stat period dims". */
function describeMetric(m: any, names: Map<string, string>): string {
  const dims = (m.Dimensions ?? []).map((d: any) => `${d.Name}=${flat(d.Value, names)}`).join(',');
  return `${m.Namespace}/${m.MetricName} ${m.Statistic ?? m.Stat} ${m.Period} [${dims}]`;
}

function alarmMetrics(alarm: Resource, names: Map<string, string>): { expression?: string; metrics: string[] } {
  const p = alarm.Properties;
  if (!p.Metrics) return { metrics: [describeMetric(p, names)] };
  const expression = p.Metrics.find((m: any) => m.Expression && m.ReturnData !== false)?.Expression;
  const metrics = p.Metrics.filter((m: any) => m.MetricStat).map((m: any) =>
    describeMetric({ ...m.MetricStat.Metric, Stat: m.MetricStat.Stat, Period: m.MetricStat.Period }, names),
  );
  return { expression, metrics };
}

test('T-WINF-12 alarms: one topic per stage, email to alarm-email', () => {
  for (const stage of STAGES) {
    const { resources } = synth(stage);
    const names = stageValueNames(resources, stage);
    const topics = ofType(resources, 'AWS::SNS::Topic');
    assert.equal(topics.length, 1, `${stage}: one topic`);
    assert.equal(topics[0][1].Properties.TopicName, `smart-finances-${stage}-alarms`);
    const subs = ofType(resources, 'AWS::SNS::Subscription');
    assert.equal(subs.length, 1, `${stage}: one subscription`);
    assert.equal(subs[0][1].Properties.Protocol, 'email');
    assert.deepEqual(subs[0][1].Properties.TopicArn, { Ref: topics[0][0] });
    assert.equal(flat(subs[0][1].Properties.Endpoint, names), '{{alarm-email}}');
  }
});

test('T-WINF-12 alarms: one metric filter per security event on the Amplify app log group', () => {
  assert.deepEqual(
    [...SECURITY_EVENTS].sort(),
    [
      'account_delete',
      'breach_check_unavailable',
      'breached_password',
      'health',
      'mfa_setup',
      'rate_limited',
      'reset',
      'signin',
      'signin_fail',
      'signout',
      'signup',
      'signup_confirm',
    ],
    'every event name in Contracts "Security events"',
  );
  for (const stage of STAGES) {
    const { resources } = synth(stage);
    const names = stageValueNames(resources, stage);
    const filters = ofType(resources, 'AWS::Logs::MetricFilter').filter(([, f]) => f.Properties.LogGroupName !== apiAccessLogGroupName(stage));
    assert.equal(filters.length, SECURITY_EVENTS.length, `${stage}: one filter per event`);
    const byEvent = new Map<string, any>();
    for (const [, f] of filters) {
      assert.equal(flat(f.Properties.LogGroupName, names), '/aws/amplify/{{amplify-app-id}}', 'the existing app log group (D-112)');
      assert.equal(f.Properties.MetricTransformations.length, 1);
      const t = f.Properties.MetricTransformations[0];
      assert.equal(t.MetricNamespace, `SmartFinances/${stage}`);
      assert.equal(t.MetricValue, '1');
      assert.equal(t.DefaultValue, undefined, 'no default value, so a missing health line is missing data');
      assert.equal(t.Dimensions, undefined);
      byEvent.set(t.MetricName, f.Properties.FilterPattern);
    }
    for (const event of SECURITY_EVENTS) assert.equal(byEvent.get(event), `{ $.event = "${event}" }`, `${stage}: filter for ${event}`);
  }
});

test('T-WINF-12 alarms: a metric filter counts status 429 in the API access log', () => {
  for (const stage of STAGES) {
    const { resources } = synth(stage);
    const filters = ofType(resources, 'AWS::Logs::MetricFilter').filter(([, f]) => f.Properties.LogGroupName === apiAccessLogGroupName(stage));
    assert.equal(filters.length, 1, `${stage}: one filter on ${apiAccessLogGroupName(stage)}`);
    const p = filters[0][1].Properties;
    assert.equal(p.FilterPattern, '{ $.status = "429" }');
    assert.deepEqual(p.MetricTransformations, [{ MetricNamespace: `SmartFinances/${stage}`, MetricName: 'Api429', MetricValue: '1' }]);
    const created = ofType(resources, 'AWS::Logs::LogGroup').filter(([, g]) => g.Properties.LogGroupName === apiAccessLogGroupName(stage));
    assert.equal(created.length, 0, 'the API stack owns the log group');
  }
});

test('T-WINF-12 alarms: every contract alarm exists, the heartbeat treats missing data as breaching', () => {
  for (const stage of STAGES) {
    const { resources } = synth(stage);
    const names = stageValueNames(resources, stage);
    const topicId = ofType(resources, 'AWS::SNS::Topic')[0][0];
    const alarms = new Map(ofType(resources, 'AWS::CloudWatch::Alarm').map(([id, r]) => [r.Properties.AlarmName as string, { id, r }]));
    const ns = `SmartFinances/${stage}`;
    const name = (slug: string) => `smart-finances-${stage}-${slug}`;

    const expected: Record<string, { op: string; threshold: number; periods?: number; missing?: string; expression?: string; metrics: string[] }> = {
      [name('signup-spike')]: { op: 'GreaterThanThreshold', threshold: 50, metrics: [`${ns}/signup Sum 3600 []`] },
      [name('signin-failures')]: { op: 'GreaterThanThreshold', threshold: 100, metrics: [`${ns}/signin_fail Sum 900 []`] },
      [name('rate-limit-refusals')]: { op: 'GreaterThanThreshold', threshold: 500, metrics: [`${ns}/rate_limited Sum 300 []`] },
      [name('web-server-errors')]: {
        op: 'GreaterThanThreshold',
        threshold: 2,
        periods: 2,
        expression: '100 * errors / requests',
        metrics: ['AWS/AmplifyHosting/5xxErrors Sum 300 [App={{amplify-app-id}}]', 'AWS/AmplifyHosting/Requests Sum 300 [App={{amplify-app-id}}]'],
      },
      [name('api-errors')]: {
        op: 'GreaterThanThreshold',
        threshold: 2,
        expression: '100 * errors / requests',
        metrics: [
          'AWS/ApiGateway/5xx Sum 300 [ApiId=select(2,split(/,select(0,split(.,{{api-url}}))))]',
          'AWS/ApiGateway/Count Sum 300 [ApiId=select(2,split(/,select(0,split(.,{{api-url}}))))]',
        ],
      },
      [name('api-throttles')]: { op: 'GreaterThanThreshold', threshold: 0, metrics: [`${ns}/Api429 Sum 300 []`] },
      [name('log-heartbeat')]: { op: 'LessThanThreshold', threshold: 1, missing: 'breaching', metrics: [`${ns}/health Sum 3600 []`] },
      [name('stuck-deletion')]: { op: 'GreaterThanThreshold', threshold: 0, metrics: [`${ns}/StuckDeletions Maximum 3600 []`] },
      [name('ses-bounce-rate')]: { op: 'GreaterThanThreshold', threshold: 0.05, metrics: ['AWS/SES/Reputation.BounceRate Maximum 300 []'] },
      [name('ses-complaint-rate')]: { op: 'GreaterThanThreshold', threshold: 0.001, metrics: ['AWS/SES/Reputation.ComplaintRate Maximum 300 []'] },
    };
    assert.ok(STAGE_FUNCTIONS.includes('housekeeping'), 'the housekeeping function alarms too (D-107)');
    for (const fn of STAGE_FUNCTIONS) {
      expected[name(`function-errors-${fn}`)] = {
        op: 'GreaterThanThreshold',
        threshold: 0,
        expression: 'errors + throttles',
        metrics: [
          `AWS/Lambda/Errors Sum 300 [FunctionName=smart-finances-${stage}-${fn}]`,
          `AWS/Lambda/Throttles Sum 300 [FunctionName=smart-finances-${stage}-${fn}]`,
        ],
      };
    }

    assert.deepEqual([...alarms.keys()].sort(), Object.keys(expected).sort(), `${stage}: the contract's alarms`);
    for (const [alarmName, want] of Object.entries(expected)) {
      const p = alarms.get(alarmName)!.r.Properties;
      assert.equal(p.ComparisonOperator, want.op, alarmName);
      assert.equal(p.Threshold, want.threshold, alarmName);
      assert.equal(p.EvaluationPeriods, want.periods ?? 1, alarmName);
      assert.equal(p.TreatMissingData, want.missing ?? 'notBreaching', alarmName);
      assert.deepEqual(p.AlarmActions, [{ Ref: topicId }], `${alarmName} goes to the topic`);
      const got = alarmMetrics(alarms.get(alarmName)!.r, names);
      assert.equal(got.expression, want.expression, alarmName);
      assert.deepEqual(got.metrics.sort(), [...want.metrics].sort(), alarmName);
    }
  }
});

test('T-WINF-12 alarms: one dashboard per stage with one widget per alarm', () => {
  for (const stage of STAGES) {
    const { resources } = synth(stage);
    const dashboards = ofType(resources, 'AWS::CloudWatch::Dashboard');
    assert.equal(dashboards.length, 1);
    assert.equal(dashboards[0][1].Properties.DashboardName, `smart-finances-${stage}`);
    const body = dashboards[0][1].Properties.DashboardBody;
    const parts: any[] = body['Fn::Join'] ? body['Fn::Join'][1] : [body];
    const alarmIds = ofType(resources, 'AWS::CloudWatch::Alarm').map(([id]) => id);
    const referenced = parts.filter((p) => p?.['Fn::GetAtt']?.[1] === 'Arn').map((p) => p['Fn::GetAtt'][0]);
    assert.deepEqual(referenced.sort(), [...alarmIds].sort(), `${stage}: each alarm has exactly one widget`);
  }
});

test('T-WINF-12 alarms: the qa stack alone creates the account budget at 50, 80 and 100% to the topic', () => {
  for (const stage of STAGES) {
    const { resources } = synth(stage);
    const names = stageValueNames(resources, stage);
    const read = [...names.values()].sort();
    const budgets = ofType(resources, 'AWS::Budgets::Budget');
    if (stage !== 'qa') {
      assert.equal(budgets.length, 0, `${stage}: no budget`);
      assert.deepEqual(read, ['alarm-email', 'amplify-app-id', 'api-url']);
      continue;
    }
    assert.deepEqual(read, ['alarm-email', 'amplify-app-id', 'api-url', 'monthly-budget-usd']);
    assert.equal(budgets.length, 1);
    const p = budgets[0][1].Properties;
    assert.equal(p.Budget.BudgetType, 'COST');
    assert.equal(p.Budget.TimeUnit, 'MONTHLY');
    assert.equal(p.Budget.BudgetLimit.Unit, 'USD');
    assert.equal(flat(p.Budget.BudgetLimit.Amount, names), '{{monthly-budget-usd}}');
    const topicId = ofType(resources, 'AWS::SNS::Topic')[0][0];
    const thresholds = p.NotificationsWithSubscribers.map((n: any) => {
      assert.equal(n.Notification.NotificationType, 'ACTUAL');
      assert.equal(n.Notification.ComparisonOperator, 'GREATER_THAN');
      assert.equal(n.Notification.ThresholdType, 'PERCENTAGE');
      assert.deepEqual(n.Subscribers, [{ SubscriptionType: 'SNS', Address: { Ref: topicId } }]);
      return n.Notification.Threshold;
    });
    assert.deepEqual(thresholds.sort((a: number, b: number) => a - b), [50, 80, 100]);

    // Budgets may publish to the topic, for this account only.
    const policies = ofType(resources, 'AWS::SNS::TopicPolicy');
    assert.equal(policies.length, 1);
    const statements = policies[0][1].Properties.PolicyDocument.Statement;
    const budgetsStatement = statements.find((s: any) => s.Principal?.Service === 'budgets.amazonaws.com');
    assert.ok(budgetsStatement, 'budgets may publish');
    assert.equal(budgetsStatement.Action, 'sns:Publish');
    assert.deepEqual(budgetsStatement.Resource, { Ref: topicId });
    assert.deepEqual(budgetsStatement.Condition, { StringEquals: { 'aws:SourceAccount': '111111111111' } });
  }
});

test('T-WINF-12 alarms: dev has no alarms stack', () => {
  assert.throws(() => synth('dev'), /no alarms stack for stage dev/);
});
