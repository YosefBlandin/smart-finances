---
spec: web-ui
ticket: none
tier: L
status: locked-v1
---
# Web UI: design system and screens: brief for smart-finances (PR 2 of 4, infra)

<!-- The executor's main document. It must stand alone: copy values in, and link only to sections a task cites. At most 6k tokens; comments do not count. Required reading (intent.md, this file and its Read first sections) stays under 15k. Before the lock, the cold-read dry run must find zero "cannot start" items. -->

- Goal: the pool opens sign-up safely, the web stack adopts the Amplify app with tables, roles, RUM, housekeeping and alarms, and CI checks, deploys and releases it.
- Implements: AC-5, AC-12, AC-13, AC-17, AC-18, AC-19, D-72, D-73, D-80, D-81, D-87 to D-89, D-93, D-102, D-104, D-106, D-107, D-109 to D-113, D-117, D-135
- Spec folder: /home/user/smart-finances/docs/specs/web-ui in a cloud session; locally <repo root>/docs/specs/web-ui. Read and write the spec there, on the branch named under Branch, never a copy elsewhere.
- Refs: smart-finances at the sha in intent.md refs. Before the first task: `git fetch origin qa feature/web-ui`, then `node ~/.claude/skills/spec/scripts/drift.mjs docs/specs/web-ui --strict` (exit 0; NEW lines are expected)
- Worktree: a cloud session's own checkout; locally <repo root>/.claude/worktrees/web-infra (profile Notes)
- Profile verify (full, at the baseline and before the PR): `npm test` and `npm run build --workspace @smart-finances/infra`. Before PR 1's SF-104 no lint exists; record "none". From then on also `npm run lint --workspace @smart-finances/web`.
- Every task may also touch, without stopping: apps/web/package.json and package-lock.json (for packages this brief allows), apps/web/messages/en.json and es.json (new keys only, both files), apps/web/src/adapters/container.ts and adapters/memory/ (to register what the task adds), and its own *.module.css files.
- Judgment: high tasks get a fresh-context reviewer before done: a subagent or fresh chat given the task, its diff and the review prompt in ~/.claude/skills/spec/references/handoff-prompts.md.
- Branch: feature/web-infra · Base: origin/feature/web-ui, after the previous PR is merged into it · Draft PR into feature/web-ui (D-121)
- Brief version: the locked-vN named in the handoff prompt; record it as pr-smart-finances-infra.md@locked-vN in progress-smart-finances-infra.json
- Order: PR 2 of 4.

## Read first
1. This file, all of it.
2. intent.md: Acceptance criteria, No-gos, Glossary.
3. architecture.md: Components "Sign-in pool changes", "Data service changes", "Web stack", "Alarms", "CI and build", "Docs"; Contracts "Sessions table", "Accounts table", "Alarms", "Stage parameters", "Web server settings", "Security events", "Response headers".
4. release.md: Rollout order and HUMAN needs.
5. test-matrix.md rows whose task is SF-121 to SF-132.

## HUMAN needs
- <HUMAN: alarm-email and, on qa, monthly-budget-usd stage parameters before the first alarms deploy> · Blocks: SF-129 qa check
- <HUMAN: redeploy the OIDC stack with the new rights after this PR merges> · Blocks: the first CI release (SF-132)
- <HUMAN: read-only check that /aws/amplify/<app id> exists in us-east-1> · Blocks: SF-125 qa check

## Global constraints
- D-6: Roles: the agent writes code, commits, pushes feature branches and opens draft PRs into qa; the user reviews, merges and promotes. Source: data-architecture spec D-4 (default).
- D-5: Agent access: local tests, builds and the dev server viewed in the browser pane, plus read-only AWS calls with the personal profile. No AWS writes and no real sign-ins; the user does those.
- D-72: Sessions: an opaque id in a __Host- cookie keys a server-side row holding the tokens; idle 30 minutes, absolute 12 hours, new id at sign-in; sign out revokes. A reload keeps you in; the session ends with the browser, not the tab. Supersedes D-47. Details: architecture.md, Contracts.
- D-73: Sign-in from the web server with a new confidential client (secret, password flow, context data); the server answers each challenge; the secret is read at run time by the compute role; the public client goes once this works on qa. Packages: AWS SDK clients for Cognito, DynamoDB and Secrets Manager, and qrcode.
- D-80: Alarms: one SNS topic and one dashboard per stage, the alarms in architecture.md, Contracts; security events logged as JSON lines with no email, IP, code or token.
- D-81: Data service for many people: stage throttle 50 per second, burst 100; no API browser rule; bucket browser rule for the Amplify address; quotas, sizing and owner-only alarms go to the data-architecture spec as follow-ups.
- D-87: Consent lives in an accounts table keyed by the person: terms and privacy versions, language and time, from the pre-auth state, written at the first completed sign-in; money screens wait until it exists. Erase-all keeps it; delete account removes it. Supersedes D-78.
- D-88: The upload bucket's browser rule is set by the web stack (a custom resource puts the rule with the Amplify branch address); the data stack stops managing it.
- D-89: Everything runs in us-east-1, where the stacks already are, so the web ACL lives in the web stack and no stage value is read across regions. Supersedes D-84.
- D-93: Amplify auto-build is off; after the web stack deploys, CI starts the Amplify job for the commit and waits for /api/health to report it. The CI role gets start and read job rights on this app only. Narrows D-65.
- D-98: Sign-up gate: the pre-sign-up trigger accepts only the web server's client, refuses disposable domains, and on qa accepts only an allow-list of test addresses until Q-8 is answered; staging and prod keep sign-up off until then. The public client is removed before any stage opens sign-up.
- D-102: The Amplify app was created in the console with Amplify's GitHub App (app smart-finances, branch qa, us-east-1); the web stack adopts it by the id in a stage parameter and sets its platform, roles, firewall and branch settings through custom resources. No GitHub token is stored. Narrows D-71.
- D-104: Delete account, final: first a full re-sign-in (password and code) and no running import; then mark deleting; that session alone may reach the finish route; erase, global sign-out, delete the pool user, remove rows. The hourly job finishes a stuck deletion by invoking the data service's delete function with the sub (one function, one grant; a follow-up row in the data-architecture spec) and alarms after 6 hours. Supersedes D-97.
- D-106: Unconfirmed sign-ups: a new sign-up for an unconfirmed email deletes the old one and starts again with the new password; code emails per email are capped at 3 an hour and 10 a day, with the same reply either way; the hourly job alone may list users to remove unconfirmed ones after 24 hours. Supersedes D-99.
- D-107: Heartbeat: the hourly job calls the branch's /api/health through the firewall, so the health line exists every hour; its own errors alarm too.
- D-109: Sign-up switch: a signup-open stage parameter, false by default, read by the pre-sign-up trigger and the sign-up screen; when false only the qa allow-list may sign up. Triggers read client ids and parameters from SSM at run time, so the data stack has no cycle.
- D-110: Web server settings: one contract table (architecture.md); the branch-variables custom resource merges into Amplify's map without dropping keys; amplify.yml writes the listed names and the commit id into .env.production before the build.
- D-111: Keep and roll back: the accounts table is retained with point-in-time recovery and deletion protection on staging and prod; custom resources clear the roles they set on delete and may pass only those two roles. Rollback (c) is a revert plus a CI-started Amplify job; the web stack is destroyed only on qa.
- D-112: The console-created app already has its log group, so the web stack references /aws/amplify/<app id> by name and sets its one-month retention through a custom resource instead of creating it.
- D-113: CI: the owner redeploys the OIDC stack with Amplify start, get and list job rights on each stage's app and read of the amplify-app-id parameters; the poll waits at most 15 minutes and fails on a failed or cancelled job; the deploy job's limit rises to 45 minutes.
- D-117: No paid Cognito plan: the pool stays on Lite with no threat protection; the web server refuses breached passwords at sign-up and reset through the free Pwned Passwords range API (only the first 5 characters of the password's SHA-1 leave the server; if the API is down, the password is accepted and the miss logged); no context data is sent. Supersedes D-94 and narrows D-73.
- D-120: No WAF for now, on any stage. Limits live in the web server's window counters: auth posts per IP 20 per 5 minutes, sign-in or reset failures per email and address prefix 5 per 15 minutes, code emails per email 3 an hour and 10 a day, data requests per person 120 a minute. A self-hosted proof-of-work check (served from the site, no third party) guards sign-up and the auth posts instead of the WAF challenge. The user accepts that floods reach the web server's compute. Supersedes D-90 and D-105.
- D-121: Integration branch: the four PRs (foundation, infra, auth, screens) each open as a draft into feature/web-ui, in order; once all are merged there, one PR from feature/web-ui into qa ships infra and web in one merge. The agent commits, pushes its feature branches and opens draft PRs; the user reviews, merges and promotes. Narrows D-6.
- D-135: Browser monitoring with CloudWatch RUM: page loads, web vitals and JavaScript errors, client bundled from npm, no cookies, addresses stripped of search values, no person ids; a guest identity pool may only put RUM events; about 1 dollar per 100,000 events.
- Values:
  - Branch per stage: qa → qa, staging → staging, prod → main; address https://<branch>.<app id>.amplifyapp.com. Stage values are read at deploy time, so synth and tests need none.
  - Metrics: namespace SmartFinances/<stage>; StuckDeletions and one metric per security event name; period 5 minutes unless the table says an hour.
  - Lambdas in infra/lambda/*.mjs are built with makeFunction (infra/lib/function.ts). Infra packages go in infra/package.json; reserved concurrency (D-95) waits for the data PRs.
  - Packages allowed: disposable-email-domains, @aws-sdk/client-amplify, -cognito-identity-provider, -ssm, -lambda, -dynamodb (same major as apps/api).
  - Stage parameters under /smart-finances/<stage>/: amplify-app-id (qa set), web-client-id, web-client-secret-arn, api-url, support-address, signup-open, imports-paused, alarm-email, monthly-budget-usd, housekeeping-hmac-secret-arn, delete-function-name (data PR 3; may be missing), rum-*.
- Rules: README.md "Layout" (only data/synthetic is committed); .gitignore block "Real financial data stays local"; docs/adr/README.md (one ADR per decision, NNNN-short-title.md); docs/threat-model.md (update when a trust boundary or data store changes); public repo: no personal data or account ids in anything committed.

## ALWAYS / ASK FIRST / NEVER
**ALWAYS**
- Write the test first and see it fail. One task, one commit.
- Put the test id in the test title.
- Record each verify command and its result in progress-smart-finances-infra.json before the next task.
- Use synthetic data only (data/synthetic). No personal data, names, account ids or real figures in code, tests, fixtures, logs or commits.

**ASK FIRST**
- Adding or upgrading a dependency that no decision or this brief's Values names.
- Any command with side effects outside the worktree and the spec folder.

**NEVER**
- Merge, mark a PR ready, promote, push a protected branch, write to cloud resources, read production or enter a password.
- Edit a decision, intent.md, decisions.md or this brief. Record a deviation in progress-smart-finances-infra.json and stop.
- Log or store a password, code, token, secret, email or IP outside the places architecture.md Contracts allows.

## Tasks
### SF-120 · Record the baselines
- Implements: none · After: none · Judgment: normal
- Files: none (no change)
- Tests first: none
- Do:
  - Create the branch from the header off origin/feature/web-ui.
  - Run `npm ci`, then `npm test` and `npm run build --workspace @smart-finances/infra` (the profile's verify), plus the web workspace's tests once it exists.
  - Run drift as the header says.
- Verify: the profile's verify.smart-finances → each result recorded under baseline, red or green
- Done when: verify is green, evidence is in progress-smart-finances-infra.json
### SF-121 · Open the pool to sign-up without replacing it, and add the confidential client
- Implements: AC-12, AC-13, D-73, D-117, D-109 · After: SF-120 · Judgment: high
- Files: smart-finances:infra/lib/data-stack.ts#DataStack, infra/test/data-stack.test.ts
- Tests first: T-WINF-1, T-WINF-2
- Do:
  - Self sign-up on; Lite plan unchanged; password minimum 12, no character classes; TOTP required unchanged.
  - New client "web-server": secret, password flow, refresh; access 60 minutes, refresh 12 hours, auth session 15 minutes; OAuth off; prevent user existence errors.
  - A Secrets Manager secret holds the client secret; publish web-client-id and web-client-secret-arn, never the value.
  - Synth test: the pool and the old client keep their logical ids; no output or parameter holds the secret.
- Verify: `npm test --workspace @smart-finances/infra` → pass
- Done when: verify is green, evidence is in progress-smart-finances-infra.json, and the reviewer has no blocker
### SF-122 · Add the pre-sign-up trigger
- Implements: AC-19, D-98, D-109, D-118 · After: SF-121 · Judgment: high
- Files: infra/lambda/pre-sign-up.mjs (new), infra/lambda/pre-sign-up.test.mjs (new), smart-finances:infra/lib/data-stack.ts#DataStack, infra/test/data-stack.test.ts
- Tests first: T-WINF-3, T-WINF-4
- Do:
  - Refuse when callerContext.clientId is not web-client-id, signup-open is not "true", or the domain is on disposable-email-domains; a refusal throws an Error whose message is the reason key.
  - Read the two parameters from SSM at run time with a 60-second cache, granted on those two only; nothing from the pool in the environment (no cycle).
- Verify: `node --test infra/lambda/pre-sign-up.test.mjs` and `npm test --workspace @smart-finances/infra` → pass
- Done when: verify is green, evidence is in progress-smart-finances-infra.json, and the reviewer has no blocker
### SF-123 · Add the custom message trigger for the email language
- Implements: AC-12, AC-20, AC-4, D-11 · After: SF-121 · Judgment: normal
- Files: infra/lambda/custom-message.mjs (new), infra/lambda/custom-message.test.mjs (new), smart-finances:infra/lib/data-stack.ts#DataStack
- Tests first: T-WINF-5
- Do:
  - Sign-up and reset code emails in en or es from clientMetadata.lang; subject "Your Cuenta code" / "Tu código de Cuenta"; one sentence with {####}.
- Verify: `node --test infra/lambda/custom-message.test.mjs` → pass
- Done when: verify is green, evidence is in progress-smart-finances-infra.json
### SF-124 · Open the API for many people and move the bucket rule
- Implements: AC-17, D-81, D-88, D-53 · After: SF-121 · Judgment: normal
- Files: smart-finances:infra/lib/api-stack.ts#ApiStack, smart-finances:infra/lib/data-stack.ts#DataStack, infra/test/api-stack.test.ts
- Tests first: T-WINF-6
- Do:
  - Audience lists both client ids; throttle 50 per second, burst 100; no API CORS. The data stack stops setting the bucket CORS; the API stack publishes api-url.
- Verify: `npm test --workspace @smart-finances/infra` → pass
- Done when: verify is green, evidence is in progress-smart-finances-infra.json
### SF-125 · Create the web stack tables and roles
- Implements: AC-14, AC-15, AC-16, D-72, D-87, D-111, D-112 · After: SF-121 · Judgment: high
- Files: smart-finances:infra/lib/web-stack.ts#WebStack (new), infra/test/web-stack.test.ts (new)
- Tests first: T-WINF-7
- Do:
  - Sessions table (pk, GSI bySub, TTL expires_at); accounts table (pk; retained, PITR, deletion protection on staging and prod); an HMAC secret with its ARN published.
  - Compute role: read the two secrets and /smart-finances/<stage>/*, read and write both tables, cognito-idp AdminGetUser, AdminDeleteUser, AdminUserGlobalSignOut on this pool only.
  - Amplify service role: logs write on /aws/amplify/<app id> only; a custom resource sets that existing group’s retention to one month.
- Verify: `npm test --workspace @smart-finances/infra` → pass
- Done when: verify is green, evidence is in progress-smart-finances-infra.json, and the reviewer has no blocker
### SF-126 · Adopt the Amplify app and set its roles, platform and variables
- Implements: D-102, D-93, D-110, D-111 · After: SF-125 · Judgment: high
- Files: smart-finances:infra/lib/web-stack.ts#WebStack, infra/lambda/amplify-vars.mjs (new), infra/test/web-stack.test.ts
- Tests first: T-WINF-8
- Do:
  - UpdateApp (platform WEB_COMPUTE, service role, compute role) and UpdateBranch (auto-build off, compute role) as custom resources; amplify-vars.mjs gets, merges and puts the branch variables, dropping no key it does not own and no secret value.
  - iam:PassRole only on the two roles; onDelete clears the roles it set.
- Verify: `npm test --workspace @smart-finances/infra` and `node --test infra/lambda/amplify-vars.test.mjs` → pass
- Done when: verify is green, evidence is in progress-smart-finances-infra.json, and the reviewer has no blocker
### SF-127 · Set the upload bucket rule from the web stack
- Implements: AC-5, D-88 · After: SF-126 · Judgment: normal
- Files: smart-finances:infra/lib/web-stack.ts#WebStack, infra/test/web-stack.test.ts
- Tests first: T-WINF-9
- Do:
  - A custom resource puts the CORS on the bucket named by bucket-name: POST from the branch address and the stage’s cdk.json origins, unchanged.
- Verify: `npm test --workspace @smart-finances/infra` → pass
- Done when: verify is green, evidence is in progress-smart-finances-infra.json
### SF-128 · Add the hourly housekeeping function
- Implements: AC-12, AC-18, D-104, D-106, D-107 · After: SF-125 · Judgment: high
- Files: infra/lambda/housekeeping.mjs (new), infra/lambda/housekeeping.test.mjs (new), smart-finances:infra/lib/web-stack.ts#WebStack, infra/test/web-stack.test.ts
- Tests first: T-WINF-10, T-WINF-11
- Do:
  - ListUsers with cognito:user_status = "UNCONFIRMED"; delete those older than 24 hours.
  - Finish deletions with status deleting: invoke the function named by delete-function-name with { sub } when that parameter exists (data PR 3), else skip and count; global sign-out; delete the user (not found is done); remove rows; put StuckDeletions for rows deleting over 6 hours.
  - GET the branch’s /api/health once. Grants: ListUsers and the admin calls on this pool, that one function, those parameters, the tables.
- Verify: `node --test infra/lambda/housekeeping.test.mjs` and `npm test --workspace @smart-finances/infra` → pass
- Done when: verify is green, evidence is in progress-smart-finances-infra.json, and the reviewer has no blocker
### SF-129 · Add the alarms stack, budget and dashboard
- Implements: AC-17, AC-19, D-80, D-107 · After: SF-128 · Judgment: normal
- Files: smart-finances:infra/lib/alarms-stack.ts#AlarmsStack (new), infra/test/alarms-stack.test.ts (new)
- Tests first: T-WINF-12
- Do:
  - Topic smart-finances-<stage>-alarms, email to alarm-email; metric filters on /aws/amplify/<app id> and every alarm in Contracts "Alarms" (heartbeat missing data breaches); one dashboard widget per alarm.
  - The qa stack alone creates the account-wide budget from monthly-budget-usd with 50, 80 and 100% to the topic. The rollup alarm comes with data PR 3.
- Verify: `npm test --workspace @smart-finances/infra` → pass
- Done when: verify is green, evidence is in progress-smart-finances-infra.json
### SF-130 · Add CloudWatch RUM and its guest identity
- Implements: D-135 · After: SF-125 · Judgment: normal
- Files: smart-finances:infra/lib/web-stack.ts#WebStack, infra/test/web-stack.test.ts
- Tests first: T-WINF-15
- Do:
  - An app monitor for the branch domain (errors, performance; no cookies) and a guest Cognito identity pool whose role may only rum:PutRumEvents on it; publish rum-app-monitor-id, rum-identity-pool-id and rum-guest-role-arn.
- Verify: `npm test --workspace @smart-finances/infra` → pass
- Done when: verify is green, evidence is in progress-smart-finances-infra.json
### SF-131 · Wire the stacks into each stage
- Implements: D-89 · After: SF-129, SF-130 · Judgment: normal
- Files: smart-finances:infra/lib/stage.ts#addStage, smart-finances:infra/bin/app.ts, infra/test/stacks.test.ts
- Tests first: T-WINF-13
- Do:
  - Order data, API, web, alarms in us-east-1; dev gets no web or alarms stack. Synth test: no stack reads a parameter a later stack writes.
- Verify: `npm test --workspace @smart-finances/infra` → pass
- Done when: verify is green, evidence is in progress-smart-finances-infra.json
### SF-132 · Extend CI: checks, deploy order, Amplify job and health check
- Implements: D-93, D-113, D-59, D-132, D-134, D-136 · After: SF-131 · Judgment: high
- Files: smart-finances:.github/workflows/deploy.yml, smart-finances:infra/lib/github-oidc-stack.ts, scripts/amplify-release.mjs (new), scripts/amplify-release.test.mjs (new)
- Tests first: T-WINF-14
- Do:
  - Before credentials: lint, web unit tests, browser tests (install Playwright chromium), Storybook build and test-storybook, lhci.
  - Deploy data, API, web, alarms; amplify-release.mjs (--stage, --branch, --sha; app id from amplify-app-id) starts a RELEASE job, polls it (15 minutes; fails on FAILED or CANCELLED), polls /api/health for the sha, and compares the headers with the contract. timeout-minutes 45.
  - The OIDC stack gains amplify:StartJob, GetJob, ListJobs on each stage’s app and ssm:GetParameter on the amplify-app-id parameters; a person deploys it.
- Verify: `npm test --workspace @smart-finances/infra` and `node --test scripts/amplify-release.test.mjs` → pass
- Done when: verify is green, evidence is in progress-smart-finances-infra.json, and the reviewer has no blocker
### SF-133 · Update the threat model, ADR 0009 and the data spec follow-ups
- Implements: D-61, D-81, D-95, D-115, D-133 · After: SF-120 · Judgment: normal
- Files: smart-finances:docs/threat-model.md, docs/adr/0009-sessions-and-sign-up.md (new), docs/adr/README.md, docs/runbooks/lost-authenticator.md (new), docs/specs/data-architecture/decisions.md
- Tests first: none
- Do:
  - Threat model: open sign-up, the web server, both tables, the secrets and RUM as trust boundaries; B1; "single user" leaves out of scope.
  - ADR 0009 per architecture.md Docs with its README row; runbook per D-115.
  - Data spec: follow-up rows for D-81, D-95 and D-133 (next free id, source "web-ui spec, <date>", proposed); edit no existing row.
- Verify: `npm test` → still green
- Done when: verify is green, evidence is in progress-smart-finances-infra.json

## Stop and hand back when
- A task would deviate from a decision. Record the deviation first.
- A value this brief needs is missing.
- Verify is still red after 2 fix rounds.
- A change is needed outside the task's Files.
- Credentials or production access are needed.
- The next step is a push to a protected branch, marking a PR ready, or a merge.
- The draft PR is open and its body is checked.

## Hand-back report
- PR: link and state
- Tool and model: as recorded in progress
- Baseline → final: tests, lint, typecheck
- Tasks: done and blocked, with commit shas
- Deviations: each with the decision it touches and the proposal
- Surprises: what this brief did not predict, with evidence
- Next HUMAN step

## PR body
No PR template exists (profile Notes). Include: what changed per task id, test ids and results, deviations, and the HUMAN steps left. The PR targets feature/web-ui (D-121), never qa.
