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
