---
spec: category-suggestions
ticket: none
tier: L
status: locked-v2
---
# In-browser category suggestions with one-tap approval: release

<!-- How the change reaches production and how it comes back out. Every gate and step has an owner: HUMAN or EXECUTOR. The executor never merges, promotes, reads production or decides a rollback. Examples sit in these comments. -->

## Plan at a glance
<!-- At most 8 numbered lines: PR order, merges, checks and promotions, each with its owner. The user approves this at the handoff decision point. -->
1. EXECUTOR: one PR on feature/category-suggestions, tasks SF-0 to SF-14; no model ships (D-30).
2. EXECUTOR: full verify, Lighthouse, conformance review, push, draft PR into qa.
3. HUMAN: the owner reviews and merges into qa; CI deploys qa.
4. HUMAN: the owner runs T-MAN-1 and T-MAN-2 on qa.
5. HUMAN: the owner promotes qa to staging, then main.

## Gates
<!-- Owner runs the check. Add rows for project-specific gates; keep the names from the conventions. -->
| Gate | When | Check | Owner | Pass when |
|---|---|---|---|---|
| G-merge | Before each PR merges | CI, conformance review, PR bot findings fixed or answered | EXECUTOR | All green and recorded on the PR |
| G-promote | Before promotion to production | Every staging and device check below | HUMAN | All pass and are recorded on the PRs |

## HUMAN needs
<!-- Values and actions only a person can supply, each as a HUMAN marker with the gate it blocks. Preflight failures from intake land here. The executor asks for these at the start and never invents them. -->
- <HUMAN: the owner merges the draft PR into qa and promotes qa to staging and main> · Blocks: G-merge, G-promote

## Staging and device checks
<!-- One row per check, citing its test ids. Fixtures use internal ids only. Checks that need a login, a device or a real gateway are HUMAN. Example row: | One page open writes one event | T-E2E-1 | staging | HUMAN | exactly one new page-view event | -->
| Check | Tests | Where | Owner | Pass when |
|---|---|---|---|---|
| Suggestions on the real review list | T-MAN-1 | qa | HUMAN | some rows show a suggestion; one tap and Accept all save and approve |
| Speed on a phone | T-MAN-2 | qa, mid-range phone | HUMAN | suggestions within about 1 s |

## Rollout order
<!-- Numbered steps with owner and the wait between them. Say what must never happen, for example one repo reaching production without the other. -->
1. HUMAN: merge into qa; wait for the deploy to finish green.
2. HUMAN: T-MAN-1 and T-MAN-2 on qa, the same day.
3. HUMAN: promote to staging, then main, with the usual checks. No order constraint: one repo, no API contract change.

## Rollback card
<!-- Decide this before the merge, not during an incident. -->
| Field | Value |
|---|---|
| Trigger | Wrong suggestions saved in bulk, review page errors, or the review page over its Lighthouse budget |
| Who decides | the owner |
| Revert path | revert the merge commit on qa (then staging and main); no data migration; choices already saved are the owner's own and stay |
| Exposure window | from the qa deploy until the revert deploys |
| Verify after revert | the review list shows the picker and Approve only; the import tests stay green (rules re-export removed with the revert) |

## Definition of done
<!-- The close step ticks these. List each AC with the check where it passed, for example: - [ ] AC-1 passes on production (T-E2E-1). -->
- [ ] Every AC passes, each with the check where it passed (AC-1 to AC-20 per test-matrix.md).
- [ ] Follow-up tickets are drafted for every deferred item.
- [ ] review.md outcome and metrics are filled, and every file's status is closed.
