---
spec: web-ui
ticket: none
tier: L
status: draft
---
# Web UI: design system and screens: release

<!-- How the change reaches production and how it comes back out. Every gate and step has an owner: HUMAN or EXECUTOR. The executor never merges, promotes, reads production or decides a rollback. Examples sit in these comments. -->

## Plan at a glance
<!-- At most 8 numbered lines: PR order, merges, checks and promotions, each with its owner. The user approves this at the handoff decision point. -->
1. HUMAN: the setup steps under HUMAN needs, before the first qa deploy.
2. EXECUTOR: prototype and design-system update for the auth and account screens (D-100); HUMAN reviews it.
3. EXECUTOR: one PR into qa with infra, web and docs; draft, then the conformance review.
4. HUMAN: merge into qa; CI deploys data, API, web and alarms, then starts the Amplify build (D-93).
5. HUMAN: the qa checks below, signing up only with allow-listed test addresses (D-98).
6. HUMAN: after Q-8, data PRs 2 and 3, SES and the concurrency raise: open sign-up on staging, check, then promote to prod.

## Gates
<!-- Owner runs the check. Add rows for project-specific gates; keep the names from the conventions. -->
| Gate | When | Check | Owner | Pass when |
|---|---|---|---|---|
| G-merge | Before each PR merges | CI, conformance review, PR bot findings fixed or answered | EXECUTOR | All green and recorded on the PR |
| G-promote | Before promotion to production | Every staging and device check below | HUMAN | All pass and are recorded on the PRs |

## HUMAN needs
<!-- Values and actions only a person can supply, each as a HUMAN marker with the gate it blocks. Preflight failures from intake land here. The executor asks for these at the start and never invents them. -->
- <HUMAN: store the Amplify app id as /smart-finances/<stage>/amplify-app-id in us-east-1 (D-102); qa done 2026-10-30, staging and prod later> · Blocks: the web stack
- <HUMAN: turn auto-build off on each Amplify branch, or let the web stack do it on its first deploy> · Blocks: first qa build
- <HUMAN: set support-address and, on qa, signup-allowlist stage parameters> · Blocks: the auth tasks' qa check
- <HUMAN: confirm the SNS alarm email subscription> · Blocks: G-promote
- <HUMAN: verify an SES domain identity and request SES production access> · Blocks: sign-up on staging and prod (D-77)
- <HUMAN: raise the account's Lambda concurrency quota and confirm it> · Blocks: sign-up on any stage beyond the qa allow-list (D-95)
- <HUMAN: send Q-8 to a lawyer and record the answer> · Blocks: public sign-up on every stage (D-98)
- <HUMAN: walk one sign-up, setup, sign-in, reset and delete account on qa with a test address> · Blocks: G-merge sign-off of the auth tasks
- <HUMAN: who promotes to production: the owner> · Blocks: G-promote

## Staging and device checks
<!-- One row per check, citing its test ids. Fixtures use internal ids only. Checks that need a login, a device or a real gateway are HUMAN. Example row: | One page open writes one event | T-E2E-1 | staging | HUMAN | exactly one new page-view event | -->
| Check | Tests | Where | Owner | Pass when |
|---|---|---|---|---|
| Sign-up, confirm, setup, sign-in, reset and delete account work end to end | manual | qa | HUMAN | each step ends where States and exits says |
| Over-limit sign-in shows the plain wait message, not a raw error | manual | qa | HUMAN | message in both languages |
| A session opened before a reset is refused after it | manual | qa | HUMAN | the old browser lands on sign-in |
| The served commit and headers match the contract | CI check | qa, staging | EXECUTOR | /api/health reports the sha; headers match |
| A test signin_fail moves its metric and the heartbeat reports | manual | qa | HUMAN | metric counts 1; heartbeat present |
| The compute role reads the secret and tables (RK-4) | manual | qa | HUMAN | sign-in works on the Amplify branch |

## Rollout order
<!-- Numbered steps with owner and the wait between them. Say what must never happen, for example one repo reaching production without the other. -->
1. HUMAN setup steps; CDK already bootstrapped in us-east-1 (the only region, D-89).
2. CI on the qa merge: data stack (pool changes, new client, triggers, secret), API stack (audience lists both clients), web stack (adopts the app, roles, firewall, tables, bucket rule, housekeeping), alarms stack; then the Amplify job and the health check.
3. After qa checks pass and the public client is removed: the same order on staging, then prod.
Never: open sign-up on any stage before Q-8; open staging or prod before SES and the concurrency raise.

## Rollback card
<!-- Decide this before the merge, not during an incident. -->
| Field | Value |
|---|---|
| Trigger | sign-in broken, a data leak between accounts, or a cost alarm at 100% |
| Who decides | the owner |
| Revert path | (a) web only: redeploy the previous Amplify job from the console. (b) sign-up only: set self sign-up off in the pool; accounts stay. (c) full: turn the branch's auto-build off, destroy the alarms and web stacks, then revert the merge; the pool and the confidential client stay until the web stack is gone. Rehearse (c) on qa before promotion. |
| Exposure window | from the qa merge until the revert's deploy finishes |
| Verify after revert | /api/health gone or at the old sha; no new sign-ups in the pool metrics |

## Definition of done
<!-- The close step ticks these. List each AC with the check where it passed, for example: - [ ] AC-1 passes on production (T-E2E-1). -->
- [ ] Every AC passes, each with the check where it passed.
- [ ] Follow-up tickets are drafted for every deferred item.
- [ ] review.md outcome and metrics are filled, and every file's status is closed.
