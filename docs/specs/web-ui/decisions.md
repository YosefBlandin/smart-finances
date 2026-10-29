---
spec: web-ui
ticket: none
tier: M
status: draft
---
# Web UI: design system and screens: decisions

<!-- The single home for every decision. Other files cite the id; a brief may copy the one-line text verbatim. Row: id, decision, door (1-way or 2-way), source and date (intake, user, stakeholder:role or design), status (proposed, accepted, superseded-by plus the new id, or RETIRED → the new id). -->
<!-- A late answer after lock never edits a row: add a new decision that supersedes the old one, then run spec-lint.mjs with --impact on the old id to find the tasks and tests that cite it. -->
<!-- Example rows:
| D-1 | Record page views as a new event type in the existing event log. | 2-way | stakeholder:security, 2026-10-29 | accepted |
| D-2 | Serve the page-view route from a new small service, not the main one. | 2-way | design, 2026-10-29 | accepted |
-->

| D | Decision | Door | Source, date | Status |
|---|---|---|---|---|
| D-1 | Tier M: one repo, a new web app, and one change to the API contract (allowed web addresses). No new server data or access rules. | 2-way | intake, 2026-10-29 | accepted |
| D-2 | Clients: only the new web app. The old app on main is not replaced or kept in step; its hosting is already off. | 2-way | intake, 2026-10-29 | accepted |
| D-3 | Scope: every screen, the assistant, citation, tool-trace and data-control screens included. First an iterable prototype sets the design system and screens; the frontend architecture is planned from it. | 2-way | intake, 2026-10-29 | accepted |
| D-4 | Design process: Claude Design first. The user refines the prototype into the design system and screens in Claude Design and hands it off; the build follows the hand-off. | 2-way | intake, 2026-10-29 | accepted |
| D-5 | Agent access: local tests, builds and the dev server viewed in the browser pane, plus read-only AWS calls with the personal profile. No AWS writes and no real sign-ins; the user does those. | 2-way | intake, 2026-10-29 | accepted |
| D-6 | Roles: the agent writes code, commits, pushes feature branches and opens draft PRs into qa; the user reviews, merges and promotes. Source: data-architecture spec D-4 (default). | 2-way | intake, 2026-10-29 | accepted |
| D-7 | Stakeholders: only the user, no fixed date. Source: data-architecture spec D-5 (default). | 2-way | intake, 2026-10-29 | accepted |
| D-8 | Audience: the brand speaks to future savers, not only the owner; screens need onboarding and plain words. Sign-up stays off for now, so strangers meet it through a demo account. | 2-way | user, 2026-10-29 | accepted |
| D-9 | Name: Cuenta, pending a trademark check. The repo keeps its name. | 2-way | user, 2026-10-29 | accepted |
| D-10 | Character: a straight-talking friend. It says the hard thing plainly, then helps. | 2-way | user, 2026-10-29 | accepted |
| D-11 | Language: English and Spanish, switchable. Spanish addresses people with tú. | 2-way | user, 2026-10-29 | accepted |
| D-12 | Visual world: Latin American concrete and kinetic art; one bold field per screen, quiet elsewhere. The leading strand is chosen from a side-by-side comparison. | 2-way | user, 2026-10-29 | accepted |
| D-13 | Bad news: the figure turns red with one plain sentence; nothing else on the screen is red. | 2-way | user, 2026-10-29 | accepted |
| D-14 | It must never feel like a bank, a game, a crypto app or a chatbot. | 2-way | user, 2026-10-29 | accepted |
| D-15 | Leading strand: Cruz-Diez bands. Colour arrives as thin vertical bands; spending is plain ink, income blue, savings green, attention amber; category colours exclude red, so red stays only for the bad figure (D-13). | 2-way | user, 2026-10-29 | accepted |

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
