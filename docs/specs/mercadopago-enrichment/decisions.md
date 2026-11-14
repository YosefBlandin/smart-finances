---
spec: mercadopago-enrichment
ticket: none
tier: M
status: executing
---
# Mercado Pago enrichment: merchant names, category codes and name-once recipient labels: decisions

<!-- The single home for every decision. Other files cite the id; a brief may copy the one-line text verbatim. Row: id, decision, door (1-way or 2-way), source and date (intake, user, stakeholder:role or design), status (proposed, accepted, superseded-by plus the new id, or RETIRED → the new id). -->
<!-- A late answer after lock never edits a row: add a new decision that supersedes the old one, then run spec-lint.mjs with --impact on the old id to find the tasks and tests that cite it. -->
<!-- Example rows:
| D-1 | Record page views as a new event type in the existing event log. | 2-way | stakeholder:security, 2026-11-14 | accepted |
| D-2 | Serve the page-view route from a new small service, not the main one. | 2-way | design, 2026-11-14 | accepted |
-->

| D | Decision | Door | Source, date | Status |
|---|---|---|---|---|
| D-1 | Tier M: one repo, a new route and new stored data; the security lens review covers third-party names. | 2-way | intake, 2026-11-14 | accepted |
| D-2 | Clients: the qa web app and the local scripts (sync and ingest:local). The old Angular app has no link to the data store (data-architecture research). | 2-way | intake, 2026-11-14 | accepted |
| D-3 | Environment: local tests and builds only. The owner runs every call that needs the Mercado Pago token or AWS credentials. Source: spec-profile.md, "Human-only actions" (not asked). | 2-way | intake, 2026-11-14 | accepted |
| D-4 | Roles: the agent writes code, commits, pushes the feature branch and opens a draft PR into qa; the owner reviews, merges and promotes. | 2-way | intake, 2026-11-14 | accepted |
| D-5 | Stakeholders: the owner alone answers every question; no fixed date. | 2-way | intake, 2026-11-14 | accepted |
| D-6 | Mercado Pago purchases that are still Uncategorized after enrichment go on the review list. | 2-way | user, 2026-11-14 (Q-1) | accepted |
| D-7 | Labeling a recipient sets the name and category on all its rows, past and future, and approves them. | 2-way | user, 2026-11-14 (Q-2) | accepted |
| D-8 | Names of people and shops from the payments service may be stored in the qa data store like transactions; delete-all removes them, and the 35-day backup window is accepted. | 1-way | user, 2026-11-14 (Q-3) | accepted |
| D-9 | The owner approved AC-1 to AC-10 and the no-gos in intent.md as written (DP2). | 2-way | user, 2026-11-14 | accepted |
| D-10 | Sync enriches each month on the owner's machine and appends three columns to the release report file; the uploaded file stays a release report the current upload path accepts. | 2-way | design, 2026-11-14 | accepted |
| D-11 | Recipient keys are made on the owner's machine with a keyed hash; the server never sees raw payments ids, account numbers or the hashing key. | 2-way | design, 2026-11-14 | accepted |
| D-12 | The hashing key is a random local file next to the reports, git-ignored, owner-only, created by sync on first use; losing it means relabeling. | 2-way | design, 2026-11-14 | accepted |
| D-13 | A label is stored once per recipient key and applied when rows are read; each label write starts a full totals rebuild. | 2-way | design, 2026-11-14 | accepted |
| D-14 | recipient_key becomes a shared transaction field, empty for other sources; the export gains one column. | 2-way | design, 2026-11-14 | accepted |
| D-15 | Mercado Pago expense categories come from the category code map, then merchant name rules, then the current rule, else Uncategorized; both lists live in a new module apart from the Notion rules. | 2-way | design, 2026-11-14 | accepted |
| D-16 | A month counts as fully synced only when its file has the enrichment columns; plain months are fetched again, a report made before the config change is requested anew, and the old file is set aside. | 2-way | design, 2026-11-14 | accepted |
| D-17 | If a payment search fails or passes 30 s, sync saves nothing for that month and reports it failed; the next run retries. | 2-way | design, 2026-11-14 | accepted |
| D-18 | A label's category beats a row's own review choice and the imported category; a label's name replaces the shown merchant and a label approves its rows. | 2-way | design, 2026-11-14 | accepted |
| D-19 | The report config default becomes the 15 live columns plus the payer name and payout account columns; the owner applies it once. | 2-way | design, 2026-11-14 | accepted |
| D-20 | ADR 0010 records the enrichment columns, recipient keys and read-time labels; the threat model gains the new assets and the owner's-machine boundary. | 2-way | design, 2026-11-14 | accepted |
| D-21 | The importer refuses a release report that still holds the payer name or payout account columns, and deletes that upload, so raw names and account numbers reach qa only through sync's cleaned file. | 2-way | design, 2026-11-14 (lens review) | accepted |
| D-22 | The label control shows on every review and transactions row with a recipient key, so labeled rows stay reachable for relabeling. | 2-way | design, 2026-11-14 (lens review) | accepted |
| D-23 | At DP3 the owner signed D-8 with the cost in its options block, confirmed that a label's category beats a row's earlier choice (D-18), and accepted D-10 to D-22 in bulk. | 2-way | user, 2026-11-14 | accepted |
| D-24 | At DP4 the owner approved the plan in pr-smart-finances.md and kept D-4: commit on the feature branch, push it, open a draft PR into qa. | 2-way | user, 2026-11-14 | accepted |

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

### D-8 options
**Options**
- A. Do nothing: no names anywhere; rows keep showing "No name" and the owner guesses from amounts.
- B. Keep names on the owner's machine only: local ingest shows them, qa never does; labels made on qa would have no names to start from.
- C. Store names on qa like other transaction text, removed by delete-all, with the 35-day backup window. ✓

**Why**: the owner reviews on qa; C is the only option where the qa review list shows who a payment went to (Q-3).
**Cost / accepted risk**: after delete-all, the backup window keeps names for up to 35 days; enriched uploads stay in the bucket until delete-all; a code revert does not remove stored names (architecture.md Cross-cutting, Rollback).
**Confirm by**: an erase test that seeds a label item, a row with a merchant name and an uploaded object, runs delete-all and finds none of them.
