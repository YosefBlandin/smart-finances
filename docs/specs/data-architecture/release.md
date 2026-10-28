---
spec: data-architecture
ticket: none
tier: L
status: locked-v1
---
# Data architecture: model, store, access patterns, ingestion and auth: release

<!-- How the change reaches production and how it comes back out. Every gate and step has an owner: HUMAN or EXECUTOR. The executor never merges, promotes, reads production or decides a rollback. Examples sit in these comments. -->

## Plan at a glance
<!-- At most 8 numbered lines: PR order, merges, checks and promotions, each with its owner. The user approves this at the handoff decision point. -->
1. EXECUTOR opens PR 1 (pr-smart-finances.md) as a draft into qa; HUMAN reviews and merges; CI deploys the qa data stack, then the qa api stack.
2. HUMAN creates the owner user and a second test user in the qa user pool.
3. EXECUTOR opens PR 2 (pr-smart-finances-imports.md) from qa with PR 1; HUMAN reviews and merges into qa.
4. EXECUTOR opens PR 3 (pr-smart-finances-reads.md) from qa with PR 2; HUMAN reviews and merges into qa, then subscribes an email to the qa rollup topic.
5. HUMAN promotes qa to staging, creates both users in the staging pool, subscribes the topic, and runs the staging checks below.
6. HUMAN adds the budget alarm, then promotes staging to main and repeats the users and topic steps for prod.
7. HUMAN makes the first real upload in prod only after step 6.

## Gates
<!-- Owner runs the check. Add rows for project-specific gates; keep the names from the conventions. -->
| Gate | When | Check | Owner | Pass when |
|---|---|---|---|---|
| G-merge | Before each PR merges | CI, conformance review, PR bot findings fixed or answered | EXECUTOR | All green and recorded on the PR |
| G-promote | Before promotion to production | Every staging and device check below | HUMAN | All pass and are recorded on the PRs |

## HUMAN needs
<!-- Values and actions only a person can supply, each as a HUMAN marker with the gate it blocks. Preflight failures from intake land here. The executor asks for these at the start and never invents them. -->
- <HUMAN: the user merges into qa and promotes qa to staging to main (D-4)> · Blocks: G-promote
- <HUMAN: the user creates a budget alarm in the shared AWS account before the first real upload (D-10)> · Blocks: G-promote
- <HUMAN: the user subscribes an email to the rollup failure topic in each stage (D-14)> · Blocks: G-promote
- <HUMAN: the user creates the owner user and a second test user in each stage's user pool (D-18, AC-3)> · Blocks: G-promote

## Staging and device checks
<!-- One row per check, citing its test ids. Fixtures use internal ids only. Checks that need a login, a device or a real gateway are HUMAN. Example row: | One page open writes one event | T-E2E-1 | staging | HUMAN | exactly one new page-view event | -->
| Check | Tests | Where | Owner | Pass when |
|---|---|---|---|---|
| Requests without a valid sign-in are refused | T-E2E-1 | staging | HUMAN | 401 and no data, both cases |
| Synthetic upload imports with counts | T-E2E-2 | staging | HUMAN | import done; counts and skipped rows shown |
| Same file again changes nothing | T-E2E-3 | staging | HUMAN | import unchanged; totals equal |
| Owner sees none of the test user's data | T-E2E-4 | staging | HUMAN | empty lists for the owner |
| Delete-all clears the test user | T-E2E-5 | staging | HUMAN | empty lists and no objects after 65 minutes |
| Encryption, PITR and public access block are on | T-E2E-6 | staging | HUMAN | all three on |

## Rollout order
<!-- Numbered steps with owner and the wait between them. Say what must never happen, for example one repo reaching production without the other. -->
1. PR 1, PR 2 and PR 3 merge into qa in that order (HUMAN). No wait beyond CI between them; PR 2 and PR 3 branch from qa after the previous merge.
2. qa to staging (HUMAN), after all three are in qa. Users and topic first, then the staging checks.
3. staging to main (HUMAN), after the staging checks pass and the budget alarm exists.
- Never promote a stage with PR 1 alone in front of real data: the data stack must not hold real rows before PR 3's delete-all and second-account test exist.
- Never load real data in any stage before the budget alarm exists (D-10).

## Rollback card
<!-- Decide this before the merge, not during an incident. -->
| Field | Value |
|---|---|
| Trigger | A staging check fails, the rollup alarm fires and a rebuild does not clear it, or a function errors on every call. |
| Who decides | HUMAN (the owner). |
| Revert path | Revert the merge commit on the affected branch; CI redeploys that stage. The api stack rolls back cleanly. The data stack keeps its retained table, bucket and pool; never delete them in staging or prod. |
| Exposure window | Until the revert deploys, about 10 minutes. No real data exists before step 7 of the plan. |
| Verify after revert | GET /health answers; T-E2E-1 passes; the table and pool still exist with the same ids. |

## Definition of done
<!-- The close step ticks these. List each AC with the check where it passed, for example: - [ ] AC-1 passes on production (T-E2E-1). -->
- [ ] AC-1 passes on staging (T-E2E-1) and in CI (T-AUTH-1, T-INF-11).
- [ ] AC-2 and AC-3 pass in CI (T-AUTH-3) and on staging (T-E2E-4).
- [ ] AC-4 to AC-9 pass in CI (T-IMP-*, T-REC-*, T-API-1 to T-API-3) and AC-4, AC-5, AC-7 on staging (T-E2E-2, T-E2E-3).
- [ ] AC-10 to AC-17 pass in CI (T-API-4 to T-API-11, T-ROL-*).
- [ ] AC-18 passes in CI (T-ERA-*) and on staging (T-E2E-5).
- [ ] AC-19 passes in CI (T-INF-2, T-INF-3) and on staging (T-E2E-6).
- [ ] AC-20 passes (T-IMP-5, recorded in progress-smart-finances-imports.json).
- [ ] Every HUMAN need above is done in each stage that holds real data.
- [ ] Follow-up tickets are drafted for every deferred item.
- [ ] review.md outcome and metrics are filled, and every file's status is closed.
