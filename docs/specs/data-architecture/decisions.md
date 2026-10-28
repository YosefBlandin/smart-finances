---
spec: data-architecture
ticket: none
tier: L
status: executing
---
# Data architecture: model, store, access patterns, ingestion and auth: decisions

<!-- The single home for every decision. Other files cite the id; a brief may copy the one-line text verbatim. Row: id, decision, door (1-way or 2-way), source and date (intake, user, stakeholder:role or design), status (proposed, accepted, superseded-by plus the new id, or RETIRED → the new id). -->
<!-- A late answer after lock never edits a row: add a new decision that supersedes the old one, then run spec-lint.mjs with --impact on the old id to find the tasks and tests that cite it. -->
<!-- Example rows:
| D-1 | Record page views as a new event type in the existing event log. | 2-way | stakeholder:security, 2026-10-20 | accepted |
| D-2 | Serve the page-view route from a new small service, not the main one. | 2-way | design, 2026-10-20 | accepted |
-->

| D | Decision | Door | Source, date | Status |
|---|---|---|---|---|
| D-1 | Tier L: the design stores personal financial data, defines who may read it, and sets keys that are hard to change once data is loaded. | 2-way | intake, 2026-10-20 | accepted |
| D-2 | Clients: only this project's apps. Today the local import scripts and tests; the web app, the API and the assistant are planned clients this design defines. No outside callers. | 2-way | intake, 2026-10-20 | accepted |
| D-3 | Agent access: local tests, builds, CDK synth and the local import, plus read-only AWS calls with the personal profile. No AWS writes; the user runs anything that changes the account. | 2-way | intake, 2026-10-20 | accepted |
| D-4 | Roles: the agent writes code, commits, pushes feature branches and opens PRs into qa; the user reviews, merges and promotes. Source: how PRs 1 and 2 ran, and the profile's human-only list (default). | 2-way | intake, 2026-10-20 | accepted |
| D-5 | Stakeholders: only the user, no fixed date. | 2-way | intake, 2026-10-20 | accepted |
| D-6 | Every stored item, uploaded file and review choice is filed under the signed-in person's identity, even with one user. | 1-way | user (Q-1), 2026-10-21 | accepted |
| D-7 | Amounts stay in their recorded currency; a dollar view converts pesos with one monthly rate the owner enters, stored apart from the rows. | 2-way | user (Q-2), 2026-10-21 | accepted |
| D-8 | Source files are the record: notes log and budget workbook rows are corrected in the file and re-uploaded. Review choices are stored only for payments report rows, kept apart and applied on top. | 1-way | user (Q-3), 2026-10-21 | accepted |
| D-9 | A new file for the same source and period replaces the earlier rows from that source and period; undo restores the previous file's rows. | 1-way | user (Q-4), 2026-10-21 | accepted |
| D-10 | The data stays in the current shared AWS account; a budget alarm is added before real data is loaded. | 1-way | user (Q-5), 2026-10-21 | accepted |
| D-11 | DP2: AC-1 to AC-20 and the no-gos approved; AC-14 and AC-15 then narrowed to follow D-8. | 2-way | user, 2026-10-21 | accepted |
| D-12 | One table per stage. Partition key is the person (U# plus the sign-in sub); sort key prefixes TXN, OVR, IMP, PER and RATE as in architecture.md Contracts "Table items". No secondary index. | 1-way | user, 2026-10-22 | accepted |
| D-13 | A separate data stack per stage holds the table, the upload bucket and the user pool. The user pool is retained in every stage; the table and bucket are retained with deletion protection in staging and prod. | 1-way | user, 2026-10-22 | accepted |
| D-14 | Month totals: a stream consumer recomputes each touched month from its rows and review choices and writes the total only if no newer computation exists; empty months get tombstones; an erase marker stops late writes. Keeps ADR 0003's stream rollups. | 2-way | user, 2026-10-22 | accepted |
| D-15 | Uploads: the client names the source; the API returns a presigned POST form for one exact key with a size range, valid 15 minutes; an S3 event through EventBridge runs the parser. | 2-way | design, 2026-10-21; owner accepted in bulk 2026-10-22 | accepted |
| D-16 | Periods: payments report and budget workbook files cover one calendar month; a notes log or generic CSV covers the whole file. One import at a time per source and period, by a conditional lock. | 2-way | design, 2026-10-21; owner accepted in bulk 2026-10-22 | accepted |
| D-17 | Undo applies only to a period's active import: it moves the period pointer to the previous file, or to none, and reconciles; a repeat undo gets conflict. Raw uploads are kept until delete-all. | 2-way | design, 2026-10-21; owner accepted in bulk 2026-10-22 | accepted |
| D-18 | Sign-in: Cognito with self sign-up off and users created by the owner; TOTP MFA required; public app client with SRP and refresh; JWT authorizer on every data route. | 2-way | design, 2026-10-21; owner accepted in bulk 2026-10-22 | accepted |
| D-19 | Encryption and recovery: AWS-owned key for the table and SSE-S3 for the bucket now; customer-managed keys stay in Epic 6. Point-in-time recovery on in every stage; erased items stay restorable for its 35-day window. | 2-way | design, 2026-10-21; owner accepted in bulk 2026-10-22 | accepted |
| D-20 | Packaging: NodejsFunction with esbuild; AWS SDK v3 packages pinned in apps/api and bundled. | 2-way | design, 2026-10-21; owner accepted in bulk 2026-10-22 | accepted |
| D-21 | Five functions, one role each: read API, write API, delete-all, parser, rollup. No wildcard resources. | 2-way | design, 2026-10-22; owner accepted in bulk with the rollup added for D-14 | accepted |
| D-22 | CI runs npm test, including infra synth tests, before deploying and deploys the data stack, then the API stack, of the stage; web origins per stage live in infra/cdk.json. Pinning actions to hashes stays in Epic 6. | 2-way | design, 2026-10-21; owner accepted in bulk 2026-10-22 | accepted |
| D-23 | A generic CSV importer reads the synthetic data shape, so evals and the demo use the same upload path. | 2-way | design, 2026-10-21; owner accepted in bulk 2026-10-22 | accepted |
| D-24 | The row schema stays in apps/api; how the web app consumes it is decided in the UI spec. | 2-way | design, 2026-10-21; owner accepted in bulk 2026-10-22 | accepted |
| D-25 | The workbook reader caps entry count and total inflated size and inflates only the parts it reads. | 2-way | design, 2026-10-21; owner accepted in bulk 2026-10-22 | accepted |
| D-26 | List, text search, review list and export read one person's rows for the asked months and filter, sort and page in the function. | 2-way | design, 2026-10-21; owner accepted in bulk 2026-10-22 | accepted |
| D-27 | The dollar view is computed when read, from rates stored as pesos per dollar with two decimals, using integer cents. | 2-way | design, 2026-10-21; owner accepted in bulk 2026-10-22 | accepted |
| D-28 | An import commits by moving its period pointer before writing rows, then reconciles: the period's stored rows are made equal to the active file's rows. Retries, re-uploads and a repair request re-run the reconcile. | 2-way | design, 2026-10-21; owner accepted in bulk 2026-10-22 | accepted |
| D-29 | Extends D-12 for D-14: adds SUM#<yyyy-mm> month totals and one ERASED marker per person, and review choices move to OVR#<date>#<id> so the rollup finds them by month. | 1-way | user, 2026-10-22 | accepted |
| D-30 | After delete-all, imports, undo, repair and totals are refused for a quiet window of 65 minutes, so no late background work can bring erased data back. | 2-way | user, 2026-10-27 | accepted |
| D-31 | DP4: the three-PR plan in release.md and the values pinned in the briefs are approved; D-4 permissions stay; PR 2's round-2 cold-read blocker is accepted as fixed without a third run. | 2-way | user, 2026-10-28 | accepted |

## Options
<!-- Only for 1-way or stakeholder decisions: one block each, headed with the decision id and "options". Mark the chosen option with ✓ and always include "do nothing". Confirm by names a test (in words at design, by id once handoff writes it) or a concrete check. Two-way design decisions need the row only. Example block:
### D-1 options
**Options**
- A. Do nothing: every call keeps writing its own event; the log stays noisy.
- B. New event type in the existing event log: current readers keep working; one filter value is added. ✓
- C. Separate page-view log: a clean shape, but every reader and the clean-up job change.

**Why**: B is the only option that keeps every current reader and the clean-up job unchanged.
**Cost / accepted risk**: events written before the release have no page type until they expire.
**Confirm by**: a staging check that one page open writes exactly one new event.
-->

### D-6 options
**Options**
- A. Do nothing: items carry no owner; only one person can ever use the store.
- B. File every item under the signed-in person. ✓
**Why**: the plan's second-account test needs it, and adding an owner later means rewriting every stored item.
**Cost / accepted risk**: a little more key design now; ids alone do not include the owner.
**Confirm by**: a test where a second test account reads, changes and deletes and touches none of the first account's items (AC-3).

### D-7 options
**Options**
- A. Do nothing: separate totals per currency, no single savings rate.
- B. Keep original amounts, add a dollar view from owner-entered monthly rates. ✓
- C. Convert on import and keep only dollars.
**Why**: one savings rate across sources without losing the original amounts.
**Cost / accepted risk**: the owner enters a rate each month; months without one are named, not guessed.
**Confirm by**: a synthetic test with mixed pesos and dollars and one missing month (AC-16).

### D-8 options
**Options**
- A. Keep every review choice apart from imported rows and apply it on top.
- B. Write review choices onto the imported row.
- C. Fix notes log and workbook rows in the source file; store choices only for payments report rows, which cannot be edited. ✓
- D. Do nothing: no review choices; flags stay until the source changes.
**Why**: the owner's files stay the single record and the review store stays small.
**Cost / accepted risk**: every correction to a notes log or workbook row is a file edit and a re-upload.
**Confirm by**: a test that a payments report choice survives a re-upload, and a choice on another source is refused (AC-14, AC-15).

### D-9 options
**Options**
- A. Replace earlier rows from the same source and period. ✓
- B. Do nothing: only add rows; corrections leave duplicates.
- C. Keep every version and let the owner choose.
**Why**: corrections land cleanly, and undo stays possible by restoring the previous file.
**Cost / accepted risk**: the period of each file must be known exactly; a wrong period would remove the wrong rows.
**Confirm by**: synthetic tests for a corrected file, a re-upload of the same file, and an undo (AC-7 to AC-9).

### D-10 options
**Options**
- A. Move to a separate AWS account before real data is loaded.
- B. Stay in the shared account and add a budget alarm. ✓
- C. Do nothing: shared account, no budget alarm.
**Why**: no account move or new setup now.
**Cost / accepted risk**: anything with administrator rights in the shared account, including the deploy roles of other projects, can read this data. Moving later is a data migration. Recorded in the threat model.
**Confirm by**: the budget alarm exists before the first real upload (release.md HUMAN need).

### D-12 options
**Options**
- A. Do nothing: no table; data stays in local files.
- B. One partition per person, typed sort keys, no index. ✓
- C. One partition per person and month, with an index for cross-month reads.
- D. A relational database instead of DynamoDB (revisits ADR 0003).
**Why**: one person holds low thousands of items, so one partition answers every access pattern with a single query, and keeps delete-all to one partition.
**Cost / accepted risk**: every read goes through one partition per person; text search is a filter, not an index. Changing keys after real data loads means copying every item.
**Confirm by**: an access-pattern test per route against the in-memory store, and the second-account test (AC-3).

### D-13 options
**Options**
- A. Do nothing: put the table, bucket and pool in the API stack, which uses delete-on-remove settings.
- B. A separate data stack per stage, the pool always retained, table and bucket retained in staging and prod. ✓
- C. One shared data stack for all stages.
**Why**: the person key is the user's sign-in id, so a recreated pool would orphan every stored item; API changes must never replace stores.
**Cost / accepted risk**: removing a dev or qa stage leaves a retained pool to delete by hand.
**Confirm by**: a synth test that the pool has retain, the prod table has retain and deletion protection, and the logical ids and replacement-sensitive properties of both are pinned.

### D-14 options
**Options**
- A. Do nothing: no totals anywhere; every client sums rows itself.
- B. Stream rollups with conditional writes, tombstones and an erase marker. ✓
- C. Sum the asked months on every read.
**Why**: the owner keeps the plan's Streams goal (E2.5) and ADR 0003; the conditional write makes duplicates, retries and parallel runs safe.
**Cost / accepted risk**: one more function, an on-failure queue and a rebuild route; a month can lag by seconds after a change.
**Confirm by**: tests that one batch delivered twice, two interleaved rollups and a stale rollup after an erase all leave correct totals (AC-11, AC-12, AC-18).

### D-29 options
**Options**
- A. Do nothing: keep D-12's prefixes; totals and the erase marker would need another table.
- B. Add SUM and ERASED items and month-prefixed review choice keys to the one partition. ✓
**Why**: the rollup finds a month's rows and choices with two range queries, and the erase check is one item in the same partition.
**Cost / accepted risk**: the erase marker keeps the person id and an erase time after delete-all.
**Confirm by**: the rollup and erase tests above, and a test that after delete-all only the marker remains.
