// Pre-sign-up trigger of the sign-in pool (D-98, D-109, D-118; architecture.md Contracts "Limits").
// A sign-up passes only when it comes through the web server's client, the stage's signup-open
// switch is exactly "true", and the email's domain is not a disposable one. A refusal throws an
// Error whose message is a reason key; Cognito turns it into a failed sign-up and the web server
// shows its plain message (AC-19). Nothing is logged: the event holds the person's email.
//
// No pool or client id comes from the environment (that would make the pool depend on its own
// trigger): the client id and the switch are stage parameters read here at run time.
import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import disposableList from 'disposable-email-domains' with { type: 'json' };
import wildcardList from 'disposable-email-domains/wildcard.json' with { type: 'json' };

export const REASONS = Object.freeze({
  client: 'client_not_allowed',
  closed: 'signup_closed',
  disposable: 'disposable_email',
  email: 'invalid_email',
});

const CACHE_MS = 60_000;
const DISPOSABLE = new Set(disposableList);
const WILDCARD = new Set(wildcardList);

/** True when the domain is listed, or is a subdomain of a domain on the wildcard list. */
export function isDisposable(domain) {
  if (DISPOSABLE.has(domain) || WILDCARD.has(domain)) return true;
  const labels = domain.split('.');
  for (let i = 1; i < labels.length - 1; i += 1) {
    if (WILDCARD.has(labels.slice(i).join('.'))) return true;
  }
  return false;
}

function domainOf(email) {
  if (typeof email !== 'string') return undefined;
  const at = email.lastIndexOf('@');
  if (at < 0) return undefined;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || undefined;
}

/**
 * @param {{ ssm: { send(command: unknown): Promise<any> }, stage: string, now?: () => number }} deps
 */
export function makeHandler({ ssm, stage, now = Date.now }) {
  const names = {
    client: `/smart-finances/${stage}/web-client-id`,
    open: `/smart-finances/${stage}/signup-open`,
  };
  let cached;

  async function settings() {
    if (!stage) throw new Error('pre-sign-up needs STAGE');
    if (cached && now() - cached.at < CACHE_MS) return cached.value;
    // A failed read throws, so the sign-up fails closed; failures are not cached.
    const out = await ssm.send(new GetParametersCommand({ Names: [names.client, names.open] }));
    const byName = new Map((out.Parameters ?? []).map((p) => [p.Name, p.Value]));
    const value = { clientId: byName.get(names.client), open: byName.get(names.open) === 'true' };
    cached = { at: now(), value };
    return value;
  }

  return async function handler(event) {
    const { clientId, open } = await settings();
    if (!clientId || event?.callerContext?.clientId !== clientId) throw new Error(REASONS.client);
    if (!open) throw new Error(REASONS.closed);
    const domain = domainOf(event?.request?.userAttributes?.email);
    if (!domain) throw new Error(REASONS.email);
    if (isDisposable(domain)) throw new Error(REASONS.disposable);
    return event;
  };
}

export const handler = makeHandler({ ssm: new SSMClient({}), stage: process.env.STAGE });
