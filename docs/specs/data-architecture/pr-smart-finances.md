---
spec: data-architecture
ticket: none
tier: L
status: executing
---
# Data architecture: model, store, access patterns, ingestion and auth: brief for smart-finances (PR 1 of 3, foundation)

<!-- The executor's main document. It must stand alone: copy values in, and link only to sections a task cites. At most 6k tokens; comments do not count. Required reading (intent.md, this file and its Read first sections) stays under 15k. Before the lock, the cold-read dry run must find zero "cannot start" items. Examples sit in these comments. -->

- Goal: the per-stage data stack, sign-in on the API and the key layer exist and are tested, so the import and read PRs only add behaviour.
- Implements: AC-1, AC-2, AC-19, D-6, D-10, D-12, D-13, D-18, D-19, D-20, D-21, D-22, D-24, D-29; the ADRs also record D-8, D-9, D-14, D-16, D-17, D-26, D-28
- Spec folder: /Users/v/projects/smart-finances/.claude/worktrees/data-architecture/docs/specs/data-architecture
- Refs: smart-finances at the sha in intent.md refs. Before the first task: `git -C /Users/v/projects/smart-finances fetch origin qa`, then `node ~/.claude/skills/spec/scripts/drift.mjs <spec folder> --strict` (exit 0; NEW lines are expected)
- Worktree: /Users/v/projects/smart-finances/.claude/worktrees/data-foundation
- Branch: feature/data-foundation · Base: origin/qa
- Brief version: the locked-vN named in the handoff prompt; record it as pr-smart-finances.md@locked-vN in progress-smart-finances.json
- Order: PR 1 of 3. PR 2 (pr-smart-finances-imports.md) and PR 3 (pr-smart-finances-reads.md) start only after this PR is merged into qa.

## Read first
1. This file, all of it.
2. intent.md: Acceptance criteria, No-gos, Glossary.
3. architecture.md: Components "Data stack", "API stack", "CI and docs"; Contracts "Identity", "Table items", "S3 keys"; Cross-cutting.
4. CLAUDE.md or AGENTS.md in the worktree, if present; README.md section "Layout".
5. test-matrix.md rows whose task is SF-1 to SF-11.
6. For SF-1 only: decisions.md, the decision table and its Options blocks; architecture.md Contracts "Rollup".
7. progress-smart-finances.json: baseline, then per task status, commit, evidence (command and result), review; deviations and surprises as lists.

## HUMAN needs
- None block this PR's tasks. Deploys happen only when the user merges (release.md).

## Global constraints
- D-4: Roles: the agent writes code, commits, pushes feature branches and opens PRs into qa; the user reviews, merges and promotes. Source: how PRs 1 and 2 ran, and the profile's human-only list (default).
- D-3: Agent access: local tests, builds, CDK synth and the local import, plus read-only AWS calls with the personal profile. No AWS writes; the user runs anything that changes the account.
- D-6: Every stored item, uploaded file and review choice is filed under the signed-in person's identity, even with one user.
- D-12: One table per stage. Partition key is the person (U# plus the sign-in sub); sort key prefixes TXN, OVR, IMP, PER and RATE as in architecture.md Contracts "Table items". No secondary index.
- D-29: Extends D-12 for D-14: adds SUM#<yyyy-mm> month totals and one ERASED marker per person, and review choices move to OVR#<date>#<id> so the rollup finds them by month.
- D-13: A separate data stack per stage holds the table, the upload bucket and the user pool. The user pool is retained in every stage; the table and bucket are retained with deletion protection in staging and prod.
- D-18: Sign-in: Cognito with self sign-up off and users created by the owner; TOTP MFA required; public app client with SRP and refresh; JWT authorizer on every data route.
- D-19: Encryption and recovery: AWS-owned key for the table and SSE-S3 for the bucket now; customer-managed keys stay in Epic 6. Point-in-time recovery on in every stage; erased items stay restorable for its 35-day window.
- D-20: Packaging: NodejsFunction with esbuild; AWS SDK v3 packages pinned in apps/api and bundled.
- D-22: CI runs npm test, including infra synth tests, before deploying and deploys the data stack, then the API stack, of the stage; web origins per stage live in infra/cdk.json.
- D-24: The row schema stays in apps/api; how the web app consumes it is decided in the UI spec.
- D-10: The data stays in the current shared AWS account; a budget alarm is added before real data is loaded.
- Values: table keys pk and sk (strings); stack names smart-finances-data-<stage> and smart-finances-api-<stage>; SSM prefix /smart-finances/<stage>/ with names table-name, bucket-name, user-pool-id, user-pool-client-id; webOrigins in infra/cdk.json context: dev and qa ["http://localhost:3000"], staging and prod []; health function 128 MB, 5 s; timestamps are ISO 8601 UTC strings except computed_at (ms epoch); function names smart-finances-<stage>-<name> for health, api-read, api-write, api-delete, parser and rollup (a release script invokes them by name).
- Rules: README.md "Layout" (only data/synthetic is committed); .gitignore block "Real financial data stays local"; docs/adr/README.md (one ADR per decision, NNNN-short-title.md); docs/threat-model.md (update for every new store, upload path and identity).
- Public repo: no personal data, names, account ids or real figures in code, tests, ADRs or commit messages.
- Logs, errors and reports carry internal ids and counts only: no names, emails, IPs or file keys.

## ALWAYS / ASK FIRST / NEVER
**ALWAYS**
- Symlink data/real in the worktree to /Users/v/projects/smart-finances/data/real (spec-profile.md Notes).
- Build every key through apps/api/src/store/keys.mjs.
- Write the test first and see it fail. One task, one commit.
- Put the test id in the test title.
- Record each verify command and its result in progress-smart-finances.json before the next task.

**ASK FIRST**
- Adding or upgrading a dependency that no decision or architecture.md Contracts names. Named here: esbuild (root devDependency); @aws-sdk/client-dynamodb, @aws-sdk/lib-dynamodb, @aws-sdk/client-s3, @aws-sdk/s3-presigned-post, @aws-sdk/client-lambda (apps/api dependencies, exact versions).
- Any command with side effects outside the worktree and the spec folder.

**NEVER**
- Run cdk deploy, cdk bootstrap or any AWS write. cdk synth and cdk diff without credentials only.
- Merge, mark a PR ready, promote, push a protected branch, write to cloud resources, read production or enter a password.
- Edit a decision. Record a deviation in progress-smart-finances.json and stop.

## Tasks

### SF-0 · Record the baselines
- Implements: none · After: none · Judgment: normal
- Files: none (no change)
- Tests first: none
- Do:
  - Create the worktree and branch from the header, from origin/qa; add the data/real symlink.
  - Run npm ci, then every verify command once, before any change.
- Verify: `npm test; npm run build --workspace @smart-finances/infra` → each result recorded under baseline, red or green
- Done when: the baseline in progress-smart-finances.json is filled and the worktree is clean

### SF-1 · Write ADRs 0004, 0006 and 0007
- Implements: D-6, D-8, D-9, D-10, D-12, D-13, D-14, D-16, D-17, D-26, D-28, D-29 · After: SF-0 · Judgment: normal
- Files: docs/adr/0004-access-patterns.md (new), docs/adr/0006-imports-source-of-record.md (new), docs/adr/0007-shared-account.md (new), docs/adr/README.md, apps/api/test/docs.test.mjs (new)
- Tests first: T-DOC-1
- Do:
  - Follow the shape of docs/adr/0003-data-store.md. Each ADR cites its D ids and copies their one-line text; options and costs come from decisions.md "Options".
  - 0004 (D-6, D-12, D-13, D-14, D-26, D-29): the Table items contract, the rollup write rule from Contracts "Rollup", and the access-pattern table (one row per route in Contracts "HTTP routes": route, key condition, filter). Ranged reads use TXN#<from> to TXN#<to>; GET /review and GET /export have no range and read every TXN# and OVR# item of the person. It fills in what ADR 0003 deferred.
  - 0006: D-8, D-9, D-16, D-17, D-28. 0007: D-10 and its accepted risk.
  - README index: list 0001 to 0004, 0006 and 0007 as accepted; 0005 stays planned. T-DOC-1 reads the files as text.
- Verify: `node --test apps/api/test/docs.test.mjs` → T-DOC-1 passes
- Done when: verify is green and evidence is in progress-smart-finances.json

### SF-2 · Update the threat model
- Implements: AC-19, D-10, D-19 · After: SF-1 · Judgment: high
- Files: docs/threat-model.md, apps/api/test/docs.test.mjs
- Tests first: T-DOC-2
- Do:
  - Assets: the data stack table, upload bucket and user pool; raw uploads kept until delete-all; the 35-day recovery window.
  - STRIDE rows for the upload path (presigned POST scope, size and type, hostile workbooks), delete-all and the ERASED marker, Cognito sign-in (no self sign-up, TOTP), and the shared-account accepted risk (D-10, RK-6), including that anyone with invoke rights in the account can call a function directly, past the authorizer.
  - Mark nothing done that this spec does not build.
- Verify: `node --test apps/api/test/docs.test.mjs` → T-DOC-1 and T-DOC-2 pass
- Done when: verify is green, evidence is recorded, and the reviewer has no blocker

### SF-3 · Infra test harness and packaging dependencies
- Implements: D-20, D-22 · After: SF-0 · Judgment: normal
- Files: package.json, package-lock.json, infra/package.json, apps/api/package.json, infra/test/stacks.test.ts (new)
- Tests first: T-INF-1
- Do:
  - Add esbuild as a root devDependency and the five @aws-sdk packages named above to apps/api dependencies: each at its newest release that is at least two weeks old, pinned exactly (no ^); record the versions in progress; commit package-lock.json.
  - infra script "test": `node --require ts-node/register --test test/*.test.ts` (checked on Node 24: ts-node handles the .ts files); root "test" runs the apps/api tests and then `npm test --workspace @smart-finances/infra`.
  - T-INF-1 builds its own cdk.App in the test and synthesizes the stacks with aws-cdk-lib/assertions Template.fromStack.
- Verify: `npm test` → all pass, T-INF-1 included
- Done when: verify is green and evidence is recorded

### SF-4 · Data stack: table and bucket
- Implements: AC-19, D-12, D-13, D-19 · After: SF-3 · Judgment: high
- Files: smart-finances:infra/lib/data-stack.ts#DataStack (new), infra/test/data-stack.test.ts (new)
- Tests first: T-INF-2, T-INF-3
- Do:
  - DataStackProps extends StackProps with stage: string and webOrigins: string[]. Construct ids: Table, Uploads, UserPool, WebClient; no physical names.
  - Table: dynamodb.Table (AWS::DynamoDB::Table, not TableV2); pk and sk strings, on-demand, point-in-time recovery on, AWS-owned encryption, no stream yet (PR 3 adds it). staging and prod: RemovalPolicy.RETAIN and deletion protection; dev and qa: DESTROY.
  - Bucket: block all public access, SSE-S3, enforceSSL, no versioning, eventBridgeEnabled true, CORS POST from webOrigins, and no CORS rule at all when webOrigins is empty; same removal split as the table, with autoDeleteObjects in dev and qa only.
  - Publish table-name and bucket-name as SSM parameters.
- Verify: `cd infra && node --require ts-node/register --test test/data-stack.test.ts` → T-INF-2 and T-INF-3 pass
- Done when: verify is green and evidence is recorded

### SF-5 · Data stack: user pool and replacement guard
- Implements: AC-1, D-13, D-18 · After: SF-4 · Judgment: high
- Files: smart-finances:infra/lib/data-stack.ts#DataStack, infra/test/data-stack.test.ts
- Tests first: T-INF-4, T-INF-5
- Do:
  - User pool: selfSignUpEnabled false; signInAliases email only, case-insensitive; email a required standard attribute and auto-verified; accountRecovery EMAIL_ONLY; featurePlan LITE; MFA REQUIRED with TOTP only, RemovalPolicy.RETAIN in every stage. One app client: no secret, SRP and refresh flows only.
  - Publish user-pool-id and user-pool-client-id as SSM parameters.
  - T-INF-5 pins the logical ids of the table and pool and their key schema and sign-in attributes, so a replacing change fails. The pinned values are this task's first synth output, written into the test as literals.
- Verify: `cd infra && node --require ts-node/register --test test/data-stack.test.ts` → T-INF-2 to T-INF-5 pass
- Done when: verify is green, evidence is recorded, and the reviewer has no blocker

### SF-6 · Wire the stacks per stage
- Implements: D-13, D-22 · After: SF-5 · Judgment: normal
- Files: infra/bin/app.ts, infra/lib/stage.ts (new), infra/cdk.json, smart-finances:infra/lib/api-stack.ts#ApiStack, infra/test/stacks.test.ts
- Tests first: T-INF-6
- Do:
  - addStage(app, stage, env) in infra/lib/stage.ts reads webOrigins[stage] from context (default []), passes it to both stacks, and creates smart-finances-data-<stage> and smart-finances-api-<stage>; app.ts calls it and tests call it; the API stack depends on the data stack and reads its values through SSM (valueForStringParameter), with no CloudFormation exports.
  - Add the webOrigins map to cdk.json context; tests pass it with new cdk.App({ context }).
- Verify: `cd infra && node --require ts-node/register --test test/stacks.test.ts` → T-INF-1 and T-INF-6 pass
- Done when: verify is green and evidence is recorded

### SF-7 · Identity and HTTP helpers
- Implements: AC-1, AC-2, D-6 · After: SF-3 · Judgment: high
- Files: apps/api/src/handlers/http.mjs#personOf (new), apps/api/src/handlers/http.mjs#reply (new), apps/api/test/http.test.mjs (new)
- Tests first: T-AUTH-1, T-AUTH-2
- Do:
  - export class HttpError extends Error with code and status; personOf(event) returns requestContext.authorizer.jwt.claims.sub, or throws HttpError('unauthorized'). It never reads path, query or body.
  - reply(status, body) returns { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }; fail(err) turns an HttpError into its status and { error: { code, message } }, and anything else into 500 internal with no detail. Codes as in Contracts "HTTP routes" (unauthorized 401, bad_request 400, not_found 404, conflict 409, source_file_only 409, too_large 413).
- Verify: `node --test apps/api/test/http.test.mjs` → T-AUTH-1 and T-AUTH-2 pass
- Done when: verify is green, evidence is recorded, and the reviewer has no blocker

### SF-8 · Key module and stores
- Implements: AC-2, D-12, D-29 · After: SF-7 · Judgment: high
- Files: apps/api/src/store/keys.mjs (new), apps/api/src/store/memory.mjs (new), apps/api/src/store/repo.mjs (new), apps/api/test/store.test.mjs (new)
- Tests first: T-KEY-1, T-KEY-2, T-KEY-3
- Do:
  - keys.mjs exports txnKey(sub, date, id), ovrKey(sub, date, id), impKey(sub, importId), perKey(sub, source, period), rateKey(sub, month), sumKey(sub, month) and erasedKey(sub), each returning { pk, sk } per Contracts "Table items", plus personPk(sub) and uploadKey(sub, importId) (a string). period is yyyy-mm or log. A part containing # or / throws; nothing else builds keys.
  - Store interface (memory.mjs and repo.mjs): get(key, { consistent }), put(item, { if }), remove(key, { if }), query({ pk, prefix | between: [lo, hi], consistent, limit, cursor }), transact([{ put | remove | check, if }]). A condition `if` is a list of clauses that must all hold: { attr, exists: bool }, { attr, op: '=' | '<' | '>' | '<=' | '>=', value }, or { any: [clauses] }. A failed condition throws ConditionFailed (exported), naming the item index in a transaction.
  - Files and calls (both stores): presignPost(key, { maxBytes, expiresSeconds }), getObject(key), deleteObject(key), listKeys(prefix), deleteObjects(keys), invokeAsync(functionName, payload). repo.mjs reads env TABLE_NAME and BUCKET_NAME.
- Verify: `node --test apps/api/test/store.test.mjs` → T-KEY-1 to T-KEY-3 pass
- Done when: verify is green, evidence is recorded, and the reviewer has no blocker

### SF-9 · API stack: authorizer, health route and function helper
- Implements: AC-1, D-18, D-20, D-21 · After: SF-6, SF-7 · Judgment: high
- Files: smart-finances:infra/lib/api-stack.ts#ApiStack, infra/lib/function.ts (new), apps/api/src/hello/index.mjs, infra/test/api-stack.test.ts (new)
- Tests first: T-INF-7, T-INF-8
- Do:
  - Create the HttpJwtAuthorizer (issuer https://cognito-idp.<region>.amazonaws.com/<pool id>, audience the app client id) as a public property of ApiStack for PR 2 and PR 3 routes; no route binds it in this PR. GET /health has no authorizer and runs the hello function; remove the catch-all default integration. Keep throttling at 10 rps, burst 20. CORS from webOrigins.
  - makeFunction(scope, { name, entry, memoryMb, timeoutSeconds, environment }) in infra/lib/function.ts makes a NodejsFunction (Node 22, esbuild bundle, own role, one-month log group, functionName per the Values) and keeps the existing reservedConcurrency context switch; the hello function uses it as health.
  - T-INF-8 fails when a policy on the role of a function this repo defines has a "*" resource; CDK's own custom-resource roles are out of scope.
- Verify: `cd infra && node --require ts-node/register --test test/api-stack.test.ts` → T-INF-7 and T-INF-8 pass
- Done when: verify is green, evidence is recorded, and the reviewer has no blocker

### SF-10 · CI runs tests and deploys both stacks
- Implements: D-22 · After: SF-9 · Judgment: normal
- Files: .github/workflows/deploy.yml, apps/api/test/ci.test.mjs (new)
- Tests first: T-CI-1
- Do:
  - Add `npm test` after npm ci and before credentials. Deploy smart-finances-data-${STAGE} then smart-finances-api-${STAGE}, both with -c stage.
  - Leave action pinning as it is (Epic 6).
- Verify: `node --test apps/api/test/ci.test.mjs` → T-CI-1 passes
- Done when: verify is green and evidence is recorded

### SF-11 · Full verify and draft PR
- Implements: none · After: SF-1 to SF-10 · Judgment: normal
- Files: none beyond earlier tasks
- Tests first: none
- Do:
  - Run the full verify and `cd infra && npx cdk synth -c stage=qa` (no credentials needed for synth; if it needs a lookup, record it as a surprise).
  - Push feature/data-foundation and open a draft PR into qa with the PR body below.
- Verify: `npm test; npm run build --workspace @smart-finances/infra` → all green
- Done when: the draft PR is open and the hand-back report is written

## Stop and hand back when
- A task would deviate from a decision. Record the deviation first.
- A value this brief needs is missing.
- Verify is still red after 2 fix rounds.
- A change is needed outside the task's Files.
- Credentials or production access are needed, including a push or gh call that fails on the machine's existing login.
- cdk synth needs AWS credentials or a context lookup.
- The next step is a push to a protected branch, marking a PR ready, or a merge.
- The draft PR is open and its body is checked.

## Hand-back report
- PR: link and state
- Tool and model: as recorded in progress
- Baseline → final: tests and typecheck (the repo has no lint script; record lint as none)
- Tasks: done and blocked, with commit shas
- Deviations: each with the decision it touches and the proposal
- Surprises: what this brief did not predict, with evidence
- Next HUMAN step

## PR body
- No PR template exists. Include: what changed per task id, test ids and results, deviations, and the HUMAN steps left (release.md HUMAN needs). Attribution follows the tool's own settings; never hard-code a model.
