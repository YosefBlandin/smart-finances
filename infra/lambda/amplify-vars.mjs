// Branch variables of the adopted Amplify app (D-110, D-111; architecture.md Contracts "Web server
// settings"). A CloudFormation custom resource behind CDK's provider framework: it gets the
// branch's variables, merges the ones it owns into them and puts the map back, because
// UpdateBranch replaces the whole map. Keys it does not own are never dropped or changed; on
// update it removes only keys it owned before and owns no longer; on delete only its own keys.
//
// No secret value is ever a variable: a name that looks like a secret must be an ARN (…_ARN), and
// is refused before any call otherwise. Amplify reserves the AWS_ prefix, so such a name is refused too. Nothing is logged and nothing is returned as Data, since
// the branch map may hold values people set by hand.
import { AmplifyClient, GetBranchCommand, UpdateBranchCommand } from '@aws-sdk/client-amplify';

const NAME = /^[A-Z][A-Z0-9_]*$/;
const SECRET_LIKE = /SECRET|PASSWORD|PASSWD|TOKEN|PRIVATE|CREDENTIAL|API_KEY/;

/** The variables a resource owns, checked: upper-case names, string values, no secret value. */
export function ownedVariables(variables) {
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) throw new Error('amplify-vars needs Variables');
  const entries = Object.entries(variables);
  if (entries.length === 0) throw new Error('amplify-vars needs at least one variable');
  for (const [name, value] of entries) {
    if (!NAME.test(name)) throw new Error(`amplify-vars: bad variable name ${JSON.stringify(name)}`);
    if (typeof value !== 'string') throw new Error(`amplify-vars: ${name} must be a string`);
    if (name.startsWith('AWS_')) throw new Error(`amplify-vars: ${name}: Amplify reserves the AWS_ prefix`);
    if (SECRET_LIKE.test(name) && !name.endsWith('_ARN')) {
      throw new Error(`amplify-vars: ${name} looks like a secret; only its ARN may be a variable`);
    }
  }
  return variables;
}

function target(props) {
  const appId = props?.AppId;
  const branchName = props?.BranchName;
  if (typeof appId !== 'string' || !appId) throw new Error('amplify-vars needs AppId');
  if (typeof branchName !== 'string' || !branchName) throw new Error('amplify-vars needs BranchName');
  return { appId, branchName, id: `amplify-vars/${appId}/${branchName}` };
}

const isNotFound = (error) => error?.name === 'NotFoundException';

function sameMap(a, b) {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && a[k] === b[k]);
}

/**
 * @param {{ amplify: { send(command: unknown): Promise<any> } }} deps
 */
export function makeHandler({ amplify }) {
  async function current({ appId, branchName }) {
    const out = await amplify.send(new GetBranchCommand({ appId, branchName }));
    return { ...(out.branch?.environmentVariables ?? {}) };
  }

  async function put({ appId, branchName }, before, after) {
    if (sameMap(before, after)) return;
    await amplify.send(new UpdateBranchCommand({ appId, branchName, environmentVariables: after }));
  }

  return async function handler(event) {
    const type = event?.RequestType;
    if (!['Create', 'Update', 'Delete'].includes(type)) throw new Error(`amplify-vars: unknown RequestType ${JSON.stringify(type)}`);
    const props = event.ResourceProperties;
    const where = target(props);
    const ours = ownedVariables(props.Variables);

    if (type === 'Delete') {
      let before;
      try {
        before = await current(where);
      } catch (error) {
        // The app or branch is gone: nothing of ours is left to remove.
        if (isNotFound(error)) return { PhysicalResourceId: where.id };
        throw error;
      }
      const after = { ...before };
      for (const name of Object.keys(ours)) delete after[name];
      await put(where, before, after);
      return { PhysicalResourceId: where.id };
    }

    // On an update of the same branch, drop what we owned and own no longer. When the branch or app
    // changes, the new id makes CloudFormation send a Delete for the old one, which cleans it up.
    const old = type === 'Update' ? event.OldResourceProperties : undefined;
    let dropped = [];
    if (old) {
      const was = (() => {
        try {
          return target(old);
        } catch {
          return undefined;
        }
      })();
      if (was?.id === where.id && old.Variables && typeof old.Variables === 'object') {
        dropped = Object.keys(old.Variables).filter((name) => !Object.hasOwn(ours, name));
      }
    }

    const before = await current(where);
    const after = { ...before };
    for (const name of dropped) delete after[name];
    Object.assign(after, ours);
    await put(where, before, after);
    return { PhysicalResourceId: where.id };
  };
}

export const handler = makeHandler({ amplify: new AmplifyClient({}) });
