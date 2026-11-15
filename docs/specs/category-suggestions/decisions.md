---
spec: category-suggestions
ticket: none
tier: L
status: draft
---
# In-browser category suggestions with one-tap approval: decisions

<!-- The single home for every decision. Other files cite the id; a brief may copy the one-line text verbatim. Row: id, decision, door (1-way or 2-way), source and date (intake, user, stakeholder:role or design), status (proposed, accepted, superseded-by plus the new id, or RETIRED → the new id). -->
<!-- A late answer after lock never edits a row: add a new decision that supersedes the old one, then run spec-lint.mjs with --impact on the old id to find the tasks and tests that cite it. -->
<!-- Example rows:
| D-1 | Record page views as a new event type in the existing event log. | 2-way | stakeholder:security, 2026-11-15 | accepted |
| D-2 | Serve the page-view route from a new small service, not the main one. | 2-way | design, 2026-11-15 | accepted |
-->

| D | Decision | Door | Source, date | Status |
|---|---|---|---|---|
| D-1 | Tier L: one repo and one PR, but it changes a security control (the web app's script policy, so WebAssembly can run) and adds a downloaded model asset. | 2-way | intake, 2026-11-15 | accepted |
| D-2 | Clients: only the web app; the repo has no other client or outside caller of the review and transactions screens. | 2-way | intake, 2026-11-15 | accepted |
| D-3 | Suggestions are worked out in the browser with a small model run through WebAssembly; no transaction text is sent to an outside AI service. | 2-way | user, 2026-11-15 | accepted |
| D-4 | Access: the agent runs local tests, builds and local model runs on synthetic rows, and may open qa read-only in the built-in browser with the owner's existing sign-in. Anything needing AWS credentials stays with the owner. | 2-way | intake, 2026-11-15 | accepted |
| D-5 | Roles: the agent writes code, commits, pushes the feature branch and opens a draft PR into qa; the owner reviews and merges. | 2-way | intake, 2026-11-15 | accepted |
| D-6 | Stakeholders: only the owner, no fixed date. (default) | 2-way | intake, 2026-11-15 | accepted |

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
