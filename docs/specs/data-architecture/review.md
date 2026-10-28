---
spec: data-architecture
ticket: none
tier: L
status: locked-v2
---
# Data architecture: model, store, access patterns, ingestion and auth: review

<!-- Tables only. Scripts check what can be checked; reviewers judge the rest. No numeric scores and no self-grading: every reviewer is a fresh context, ideally on a different model. M tier adds this file with new-spec.mjs --add review.md when it first needs it. Examples sit in these comments. -->

## Lens review
<!-- At G-design. One fresh reviewer per lens: security and data; contract and deploy; pre-mortem (states and exits); frontend when there is a web or app UI PR. Reviewers report only correctness or requirement gaps, with evidence. Rows have no ids; cite the AC or decision a finding touches. Severity: blocker, major or minor. Disposition: accepted (what changed, where) or rejected (why, with evidence). Example row: | contract and deploy | major | Reads would still write an event per call if the old logger stays on. | D-1 | architecture.md Components | accepted: the logger skips reads; a test checks it | -->
| Lens | Severity | Finding | Cites | Evidence | Disposition |
|---|---|---|---|---|---|
| pre-mortem | blocker | A crash between writing new rows and deleting old ones, with retries used up, leaves the import importing and its extra rows counted. | AC-7, AC-8, AC-11, D-9 | architecture.md States and exits (first draft) | accepted: planned row_keys saved before writing; cleanup mode on the parser's on-failure destination; a lock take-over cleans the stale import first. Test in words: crash between put and delete, exhaust retries, then re-upload the original file. |
| security and data | major | Delete-all has no fence against an upload form issued before it, or a parser that starts after its check. | AC-18, D-15 | architecture.md States and exits, erasing | accepted: erase refused while any import is importing or requested and unexpired; the parser writes nothing and deletes the object when its record is missing. Test: upload after an erase. |
| security and data | major | s3:ListBucket scoped to uploads/* cannot list anything. | AC-18, D-21 | architecture.md API stack, api-delete | accepted: ListBucket on the bucket ARN with an s3:prefix condition; DeleteObject on the object ARN. |
| security and data | major | Parser timeout, lock re-entry and the end of retries are not stated. | AC-7, AC-8, D-16 | architecture.md States and exits | accepted: parser 5 minutes, lock 10 minutes, same-import re-entry, cleanup mode. |
| security and data | major | D-12 and Cross-cutting still name stored month totals after D-14 removed them. | D-12, D-14 | decisions.md D-12; architecture.md Cross-cutting | accepted: SUM removed from D-12; Cross-cutting reads transaction and review-choice items. |
| contract and deploy | major | Bucket in the data stack and an S3 trigger on a parser in the API stack form a cross-stack cycle. | D-13, D-15, AC-4 | architecture.md Data stack, API stack | accepted: EventBridge notifications on the bucket, rule in the API stack; synth tests cover both stacks. |
| contract and deploy | major | Retain does not stop a replacement of the pool or table, which would orphan every person's items. | D-13, D-6 | decisions.md D-13 | accepted: synth test pins logical ids and replacement-sensitive properties; RK-10 with recovery steps. |
| pre-mortem | major | No memory or timeout is set, so 20 MiB workbooks would time out at the hello defaults. | AC-4, AC-6, D-25 | architecture.md API stack | accepted: memory and timeout per function; the zip-bomb test runs under the parser's memory. |
| pre-mortem | major | Duplicate or late events re-run an import, overwriting status or repeating history. | AC-4, AC-7, AC-9 | architecture.md States and exits | accepted: conditional move from requested; ignored state; history without repeats. Tests: two concurrent deliveries, and a delivery after done. |
| pre-mortem | major | Undo is undefined for repeats, non-active targets and undo of an undo. | AC-9, D-17 | architecture.md HTTP routes | accepted: undo rules in Contracts; D-17 updated. Tests: double POST, undo of a replaced import. |
| pre-mortem | major | Delete-all ignores imports in requested, which hold no lock. | AC-18, AC-19 | architecture.md States and exits | accepted: same change as the security and data delete-all finding. |
| pre-mortem | major | A payments report spanning two months could be filed under one period and double count. | AC-7, AC-8, D-16 | research.md ids rows | rejected for double counting: the importer keeps only the opening month's rows (research.md, Mercado Pago amount row), so no row lands in a wrong period. accepted in part: periodOf now lists the rows outside the month as skipped. |
| security and data | minor | Point-in-time recovery keeps erased items restorable. | AC-18, D-19 | decisions.md D-19 | accepted: 35-day window stated in D-19, architecture.md and the threat model task. |
| security and data | minor | D-13 has no ADR. | D-13 | architecture.md CI and docs | accepted: ADR 0004 covers D-13. |
| security and data | minor | An over-size file ends as expired with no reason. | AC-6 | architecture.md HTTP routes | accepted: expired imports state that the file never arrived, for example over the limit. |
| contract and deploy | minor | CloudFormation exports would lock the API stack's inputs. | D-13, D-22 | architecture.md Data stack | accepted: SSM parameters instead of exports. |
| contract and deploy | minor | Cross-cutting describes stored totals. | D-14, AC-11 | architecture.md Cross-cutting | accepted: fixed with the D-12 finding. |
| contract and deploy | minor | Import summary and review object fields are not listed. | AC-4, AC-10, AC-14 | architecture.md HTTP routes | accepted: fields listed. |
| contract and deploy | minor | CI never passes webOrigins, so every stage allows only localhost. | D-22, AC-4 | architecture.md API stack | accepted: per-stage map in infra/cdk.json. |
| contract and deploy | minor | A file posted after delete-all leaves a raw object. | AC-18, D-17 | architecture.md S3 keys | accepted: the parser deletes objects with no import record. |
| pre-mortem | minor | D-12 and Cross-cutting describe stored totals. | D-12, D-14 | decisions.md D-12 | accepted: same change as above. |
| pre-mortem (re-run) | blocker | A crashed import's retry is classed ignored, so it stays importing forever and blocks delete-all. | AC-18, AC-9, D-16 | architecture.md States and exits (second draft) | accepted: replaced with commit-then-reconcile (D-28); retries re-enter through the lock rule; stalled shown after lock_until; erase blocks only on a live lock. |
| pre-mortem (re-run) | major | A failed undo can never be retried, and undo imports have no expiry. | AC-9, D-17 | architecture.md HTTP routes | accepted: undo moves the pointer and reconciles; repair finishes a stalled undo; no undo import record. |
| pre-mortem (re-run) | major | After a partial failure, overlapping payments report keys keep a failed file's values. | AC-8, AC-11, D-9 | apps/api/src/ingest/mercadopago.mjs ids | accepted: the pointer moves before writing and reconcile converges to the active file; test with overlapping keys and a crash. |
| pre-mortem (re-run) | major | Cleanup mode's own failure path and a function as its own destination are undefined. | D-21 | architecture.md API stack | accepted: cleanup mode and the destination removed. |
| pre-mortem (re-run) | major | No tests named for crash, takeover, concurrent runs or erase after a crash. | AC-7, AC-12, D-16 | architecture.md RK-3 | accepted: RK-3 names each test in words. |
| pre-mortem (re-run) | minor | Lock release is not conditional on the holder. | D-16 | architecture.md States | accepted: every lock and pointer write is conditional on lock_import. |
| pre-mortem (re-run) | minor | History capped at 10 makes a late undo remove rows. | AC-9, D-17 | architecture.md Table items | accepted: no cap. |
| pre-mortem (re-run) | minor | The erase precheck is not atomic with an import starting. | AC-18 | architecture.md States | accepted: the ERASED marker added with D-14 and D-29 makes the parser's lock write fail for an import created before an erase. The move also requires event time before expires_at. |
| pre-mortem (rollup pass) | major | Undo and repair reconciles take no lock and skip the erase check. | AC-8, AC-9, AC-18, D-17, D-28 | architecture.md Parser input | accepted: undo and repair create records that take the period lock with the erase check; tests for repair overlapping an import and delete-all during a repair. |
| pre-mortem (rollup pass) | major | Rollups triggered by delete-all's own deletions rewrite month totals. | D-29, D-14, AC-18 | architecture.md Rollup | accepted: erase window with quiet_until beyond the stream's 1-hour record age (D-30); test that only ERASED remains. |
| pre-mortem (rollup pass) | major | A late retry of an older import can commit over a newer one; non-committed imports never end. | D-9, AC-8, D-16 | architecture.md States | accepted: commit requires the active import's id to sort earlier, else superseded; reconcile marks older open imports superseded. |
| pre-mortem (rollup pass) | major | A rollup batch in the on-failure queue gives no signal. | AC-11, D-14 | architecture.md Cross-cutting | accepted: queue depth alarm to an SNS topic; owner subscribes (release.md HUMAN need); synth test. |
| pre-mortem (rollup pass) | major | A failed undo or repair is invisible. | AC-9, D-17 | architecture.md HTTP routes | accepted: undo and repair are import records with statuses, shown in GET /imports. |
| pre-mortem (rollup pass) | minor | Skipped list capped at 200 conflicts with AC-5. | AC-5 | architecture.md Import record | accepted: every skipped row is kept; over 2,000 unreadable rows fails the file as a whole (AC-6). |

## Cold-read log
<!-- At G-handoff, one run per brief and round: a fresh context on a cheaper or different model gets only intent.md, the brief and the sections it cites (tier S: spec.md). Model class is cheaper, different, or same in a fresh context; never a model name. Gate: zero cannot-start items. -->
| Brief | Round | Date | Model class | Cannot start | Missing values | Assumptions | Fixed in |
|---|---|---|---|---|---|---|---|
| pr-smart-finances.md | 1 | 2026-10-27 | same, fresh context | 2 (SF-1 decision text not cited; docs.test.mjs not in Files) | 13 | 15 | brief: Read first items 6 and 7, drift command, SF-1 to SF-9 files and values (store interface, HttpError, makeFunction, addStage, authorizer as a property), versions rule; test-matrix T-INF-7 |
| pr-smart-finances-imports.md | 1 | 2026-10-27 | same, fresh context | 1 (SF-22 field mapping for generic CSV rows) | 20 | 17 | brief: Values for CSV mapping, timestamps, lock re-entry, page size, expired reason, baseline under data/real, ulid.mjs, PR 1 interfaces; test-matrix T-INF-9 |
| pr-smart-finances-reads.md | 1 | 2026-10-27 | same, fresh context | 0 | 10 | 19 | brief: drift command, symlink target, SSM name, ROLLUP_FUNCTION, starting position, alarm and topic values, rounding, totals conflict in SF-45, SF-48 after SF-45 |
| pr-smart-finances.md | 2 | 2026-10-27 | same, fresh context | 0 | 8 | 24 | brief: table and pool types and attributes, keys.mjs exports, repo.mjs test T-KEY-3, review and export read rule in ADR 0004, webOrigins context, lint baseline |
| pr-smart-finances-imports.md | 2 | 2026-10-27 | same, fresh context | 1 (SF-29 After lacked SF-27) | 8 | 13 | brief: SF-29 After, excel name pattern, ingest:local diff ignores the timestamp line, import record contents, parser-only invoke grant; not re-run (2-round limit); user-accepted, D-31 |

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
