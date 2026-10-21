---
spec: data-architecture
ticket: none
tier: L
status: draft
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
