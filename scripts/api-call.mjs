#!/usr/bin/env node
// Calls one data route of a deployed stage as a given person, for release checks
// (docs/specs/data-architecture/release.md). It builds the event API Gateway hands a handler after
// the JWT authorizer, with that sub in the claims, and invokes the function that serves the route
// with your own AWS profile. No sign-in or token is involved, so use it only with test users. It
// refuses prod, where a forged claim would skip sign-in for anyone allowed to invoke the function,
// and DELETE needs --yes.
//
//   AWS_PROFILE=<profile> node scripts/api-call.mjs --stage staging --as <sub> GET '/transactions?from=2026-01&to=2026-12'
//   AWS_PROFILE=<profile> node scripts/api-call.mjs --stage staging --as <sub> PUT /rates/2026-05 '{"ars_per_usd":1000}'
//   AWS_PROFILE=<profile> node scripts/api-call.mjs --stage staging --as <sub> --upload data/synthetic/transactions.csv
//
// --upload asks POST /imports for a form (source csv unless the JSON says otherwise; file name and
// size from the file), posts the file to it, and prints the import id to follow with GET /imports/{id}.
// It prints the status and the reply body; the body is that person's data, so keep it to test users.
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTES } from '@smart-finances/contracts/routes';

const STAGES = ['qa', 'staging'];
const USAGE = 'usage: node scripts/api-call.mjs --stage qa|staging --as <sub> [--yes] (<METHOD> <path> [json] | --upload <file> [json])';

function checkStage(stage) {
  if (!STAGES.includes(stage)) throw new Error(`--stage must be one of ${STAGES.join(', ')}`);
}

// The function that serves each route (architecture "API stack").
const functionFor = (routeKey) => {
  if (routeKey === 'GET /health') return 'health';
  if (routeKey.startsWith('GET ')) return 'api-read';
  if (routeKey.startsWith('DELETE ')) return 'api-delete';
  return 'api-write';
};

// '/imports/{id}' matches '/imports/abc' with { id: 'abc' }; segments are compared one by one.
function matchRoute(method, rawPath) {
  const parts = rawPath.split('/');
  for (const key of Object.keys(ROUTES)) {
    const [m, template] = key.split(' ');
    if (m !== method) continue;
    const want = template.split('/');
    if (want.length !== parts.length) continue;
    const params = {};
    const hit = want.every((w, i) => {
      const name = /^\{([a-z]+)\}$/.exec(w)?.[1];
      if (!name) return w === parts[i];
      if (!parts[i]) return false;
      params[name] = decodeURIComponent(parts[i]);
      return true;
    });
    if (hit) return { routeKey: key, pathParameters: Object.keys(params).length ? params : undefined };
  }
  throw new Error(`no route ${method} ${rawPath}`);
}

/** The function name and the HTTP API (payload 2.0) event for one call. Calls nothing. */
export function buildCall({ stage, sub, method, path: target, body, yes = false }) {
  checkStage(stage);
  if (typeof sub !== 'string' || !sub.trim()) throw new Error('--as <sub> is required');
  const verb = String(method).toUpperCase();
  if (verb === 'DELETE' && !yes) throw new Error('DELETE deletes all of that person\'s data; add --yes to go ahead');
  const [rawPath, rawQueryString = ''] = String(target).split(/\?(.*)/s);
  const { routeKey, pathParameters } = matchRoute(verb, rawPath);
  const query = new URLSearchParams(rawQueryString);
  if (body !== undefined) {
    try {
      JSON.parse(body);
    } catch {
      throw new Error('the body must be JSON');
    }
  }
  const event = {
    version: '2.0',
    routeKey,
    rawPath,
    rawQueryString,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    requestContext: { authorizer: { jwt: { claims: { sub } } }, http: { method: verb, path: rawPath } },
    ...(rawQueryString ? { queryStringParameters: Object.fromEntries(query) } : {}),
    ...(pathParameters ? { pathParameters } : {}),
    ...(body === undefined ? {} : { body }),
  };
  return { functionName: `smart-finances-${stage}-${functionFor(routeKey)}`, event };
}

/** The POST /imports body for a file: its name and size, source csv unless the JSON names one. */
export function uploadRequest(file, size, json) {
  return JSON.stringify({ source: 'csv', ...(json ? JSON.parse(json) : {}), file_name: path.basename(file), size });
}

export function parseArgs(argv) {
  const out = { stage: undefined, sub: undefined, upload: undefined, yes: false };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--yes') {
      out.yes = true;
    } else if (arg === '--stage' || arg === '--as' || arg === '--upload') {
      if (argv[i + 1] === undefined) throw new Error(USAGE);
      out[{ '--stage': 'stage', '--as': 'sub', '--upload': 'upload' }[arg]] = argv[(i += 1)];
    } else if (arg.startsWith('--')) {
      throw new Error(USAGE);
    } else {
      rest.push(arg);
    }
  }
  if (!out.stage || !out.sub) throw new Error(USAGE);
  checkStage(out.stage);
  if (out.upload) {
    if (rest.length > 1) throw new Error(USAGE);
    return { stage: out.stage, sub: out.sub, method: 'POST', path: '/imports', body: rest[0], upload: out.upload, yes: out.yes };
  }
  if (rest.length < 2 || rest.length > 3) throw new Error(USAGE);
  if (rest[0].toUpperCase() === 'DELETE' && !out.yes) throw new Error('DELETE deletes all of that person\'s data; add --yes to go ahead');
  return { stage: out.stage, sub: out.sub, method: rest[0], path: rest[1], body: rest[2], upload: undefined, yes: out.yes };
}

async function invoke(functionName, event) {
  // Loaded here, so building an event (and its test) never touches the SDK or AWS.
  const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
  const client = new LambdaClient({});
  const out = await client.send(new InvokeCommand({ FunctionName: functionName, Payload: Buffer.from(JSON.stringify(event)) }));
  const payload = out.Payload ? JSON.parse(Buffer.from(out.Payload).toString('utf8')) : null;
  if (out.FunctionError) throw new Error(`${functionName} failed: ${payload?.errorType ?? out.FunctionError}`);
  return payload;
}

async function main(argv) {
  const args = parseArgs(argv);
  const body = args.upload ? uploadRequest(args.upload, statSync(args.upload).size, args.body) : args.body;
  const { functionName, event } = buildCall({ ...args, body });
  const reply = await invoke(functionName, event);
  console.log(reply.statusCode);
  console.log(reply.body);
  if (!args.upload || reply.statusCode !== 201) return reply.statusCode < 400 ? 0 : 1;

  const { import_id: importId, upload } = JSON.parse(reply.body);
  const form = new FormData();
  for (const [name, value] of Object.entries(upload.fields)) form.append(name, value);
  form.append('file', new Blob([readFileSync(args.upload)]), path.basename(args.upload));
  const posted = await fetch(upload.url, { method: 'POST', body: form });
  console.log(`upload ${posted.status}; follow with: GET /imports/${importId}`);
  return posted.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err.message);
      process.exit(2);
    },
  );
}
