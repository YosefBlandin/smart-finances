---
spec: mercadopago-enrichment
ticket: none
tier: M
status: executing
---
# Mercado Pago enrichment: merchant names, category codes and name-once recipient labels: review

<!-- Tables only. Scripts check what can be checked; reviewers judge the rest. No numeric scores and no self-grading: every reviewer is a fresh context, ideally on a different model. M tier adds this file with new-spec.mjs --add review.md when it first needs it. Examples sit in these comments. -->

## Lens review
<!-- At G-design. One fresh reviewer per lens: security and data; contract and deploy; pre-mortem (states and exits); frontend when there is a web or app UI PR. Reviewers report only correctness or requirement gaps, with evidence. Rows have no ids; cite the AC or decision a finding touches. Severity: blocker, major or minor. Disposition: accepted (what changed, where) or rejected (why, with evidence). Example row: | contract and deploy | major | Reads would still write an event per call if the old logger stays on. | D-1 | architecture.md Components | accepted: the logger skips reads; a test checks it | -->
| Lens | Severity | Finding | Cites | Evidence | Disposition |
|---|---|---|---|---|---|
| security-data, premortem | blocker | A row's earlier review choice kept its category over a new label, so labeling did not set the category on every row. | AC-6, D-7, D-18 | Contracts "How a label applies"; F-4 | accepted: the label's category now wins (D-18 revised, Alternatives fork added); RK-5 retargeted to relabeling |
| contract-deploy, frontend | blocker | Stored rows have no recipient_key; a required field makes the web reject whole replies as bad_reply. | D-14, AC-2, AC-5 | query.mjs fieldsOf; routes.mjs Transaction; web data-api.ts parse | accepted: fieldsOf and reconcile read a missing value as empty; test named in Contracts "Transaction field" |
| security-data, contract-deploy | major | After the config change any report carries raw payer names and account numbers; a hand-uploaded one bypasses sync's stripping. | D-11, D-19, AC-10 | D-10; F-1, F-7, F-17 | accepted: new D-21, parser refuses and deletes the upload (Importer, Contracts "Import failure code"); config revert added to Rollback |
| contract-deploy, premortem | major | Sync reuses reports made before the config change, and runs before the config is applied would mark months full for good. | AC-4, D-16, D-19 | mercadopago-sync.mjs reuse path; live check 1 | accepted: sync checks the config first and requests a new report when the header lacks the columns (D-16 revised, States) |
| premortem | major | Nothing has checked that the report accepts and fills the payer name and payout account columns. | AC-4, AC-6, D-19 | research.md live checks | accepted: HUMAN column check right after the config step; RK-7 with a stop and a new D-n if a column is missing |
| security-data | major | A failed async rebuild after a label write raises no alarm. | D-13 | api-stack.ts addRollup: only the stream has onFailure | accepted: async-invoke on-failure destination to RollupFailures, infra test (Write route) |
| premortem | major | Overlapping rebuilds have no stated behaviour. | D-13 | States and exits | accepted: recomputeMonth's start-time guard already makes the last-started rebuild win; stated with a test (Labels in the store) |
| premortem | major | A failure while counting rows after the commit leaves totals unrebuilt. | D-13 | Write route | accepted: the route no longer counts; rebuild requested right after the commit; "invoke refused" state added |
| premortem, frontend | major | Labeled rows leave the review list and cannot be reached to relabel or override. | D-7, D-18, RK-5 | review.mjs list rule; transactions screen has no controls | accepted: new D-22, label control on transactions rows with a key too |
| security-data, contract-deploy, frontend | major | One-way door D-8 has no options block. | D-8 | decisions.md Options | accepted: D-8 options block with do nothing, cost and confirm-by |
| contract-deploy | major | Rollback leaves names in uploads and months with no plain file; totals keep label categories after a revert. | D-8, D-13 | Cross-cutting Rollback | accepted: Rollback states delete-all is the only full removal and adds a HUMAN rebuild after the revert |
| frontend | major | The label form does not cite the accessibility, React Aria and Storybook rules. | AC-6 | web-ui architecture.md "Accessibility"; web-ui decisions 129, 141 | accepted: cited in Web screens with the four stories |
| frontend | major | The label save has no pending or rollback behaviour and is not tied to the review in-flight guard. | AC-6 | Review.tsx mutation guard | accepted: disabled while saving, optimistic removal with return on refusal, shared in-flight guard |
| security-data | minor | rejected/ keeps the raw download, which would carry raw columns. | AC-10 | mercadopago-sync.mjs rejected path | accepted: rejected files have the raw columns removed |
| security-data | minor | The probe still prints part of HTTP error bodies. | AC-10 | mercadopago-probe.mjs brief | accepted: the error-line rule covers the probe |
| security-data | minor | The no-names log rule does not cover the web action, and the web logger allows name fields. | AC-10 | log.ts REFUSED | accepted: labelRecipient logs no name; name, merchant and payer added to refused fields |
| premortem | minor | Search requests have no timeout. | D-17, RK-4 | States and exits | accepted: 30 s timeout counts as a failure (D-17 revised) |
| frontend | minor | Totals refresh before the async rebuild finishes. | D-13 | Review.tsx invalidation | accepted: one more totals refresh after 5 s |
| frontend | minor | A label can be Uncategorized and approve rows off the review list. | AC-5 | View.tsx category options | accepted: Uncategorized excluded from the label contract and select |
| contract-deploy | minor | mercadopago-report.mjs was marked new but exists at the pin; the sync and probe modules are not at the pin. | D-10, D-19 | git cat-file at f9836e0 | accepted: mark dropped; the PR's first task commits the sync and probe modules as they are |

## Cold-read log
<!-- At G-handoff, one run per brief and round: a fresh context on a cheaper or different model gets only intent.md, the brief and the sections it cites (tier S: spec.md). Model class is cheaper, different, or same in a fresh context; never a model name. Gate: zero cannot-start items. -->
| Brief | Round | Date | Model class | Cannot start | Missing values | Assumptions | Fixed in |
|---|---|---|---|---|---|---|---|
| pr-smart-finances.md | 1 | 2026-11-14 | same, fresh context | 0 | 16 | 22 | pr-smart-finances.md: drift path, baseline fields, payment field paths, config reply shape, 15 columns, gh line, D-20 line, and files added to SF-2, SF-6, SF-7, SF-10, SF-12, SF-13; the 3 HUMAN items already listed; assumptions accepted (they match the design) |

## Conformance review
<!-- Before each draft PR: a fresh reviewer compares the diff with the brief and its test ids. A finding that needs a decision becomes a deviation, not an edit. -->
| Brief | Date | Tasks matched | Test ids found | Off-brief changes | Verdict |
|---|---|---|---|---|---|

## Outcome
<!-- At G-close. One line per AC: pass, fail or partial, and where it was verified, for example: - AC-1: pass, T-E2E-1 on production. Then the merge sha per repo. -->

## Defects
<!-- Every defect found after G-handoff. Origin: spec-gap (the spec was silent), spec-wrong (the spec was wrong), executor (the brief was right, the code was not), env (tools, access, CI). -->
| Defect | Origin | Found at | Fixed in | Kit change |
|---|---|---|---|---|

## Metrics
| Metric | Value |
|---|---|
| Decision point minutes (DP1, DP2, DP3, DP4) | |
| Decision rounds after G-design | |
| Lens findings, and the share rejected (%) | |
| Cold-read cannot-start items, per round | |
| Deviations | |
| Folder tokens; executor required reading (status.mjs) | |

## Kit changes
<!-- Each recurring issue becomes a lint rule or a template change in agent-kit. One line each, naming the defect or metric behind it. -->
