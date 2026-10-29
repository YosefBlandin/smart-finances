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
| D-16 | Type: Chivo for words and amounts, with tabular digits; Chivo Mono only for raw imported text and ids. Both are by a Buenos Aires foundry. Chivo is the widest of the shortlist, so Spanish wraps in tables and chips get checked. | 2-way | user, 2026-10-29 | accepted |
| D-17 | Icons: Tabler outline icons at a 2px line, which matches the stem of Chivo 400. They mark the current screen, statuses, review reasons, notes and assistant answers, always next to a word. Narrows D-15: bands now appear only where they carry a number (the spending strip, bars and the category key) plus the logo. | 2-way | user, 2026-10-29 | accepted |
| D-18 | Overview order, as one column read top to bottom: what you kept against your typical month; one line for what is waiting, only when something is; where it went, with the band strip as the header and the amounts under it; how you are doing over time; where you spent the most. No grid of equal panels. Net worth stays hidden until there is data for it. | 2-way | user, 2026-10-29 | accepted |
| D-19 | Wording: each overview section opens with its finding as a short headline sentence, not a neutral label. | 2-way | user, 2026-10-29 | accepted |
| D-20 | Typical month means the average of the previous six months. The user chose the average knowing one unusual month moves it: with the sample data, a month with a large one-off purchase pulls it from about 34% to about 20%. | 2-way | user, 2026-10-29 | accepted |
| D-21 | Light-mode ground: one colour field. The answer sits on a solid savings-green field, and in a bad month on an ink field, so red stays on the one bad figure (D-13). Below the field the page is white with no cards; sections are told apart by space and fine rules. The dark version is still to be designed. | 2-way | user, 2026-10-29 | accepted |
| D-22 | Type and spacing rules: sizes 12, 14, 16, 20, 24, 32, 48 plus one display size; body 16, tables and data 14, uppercase labels 12 with one letter-spacing. Weights 400, 500 and 700, with 800 only for the display figure. Spacing uses only the 4px-based tokens. Text meets 4.5:1 contrast and input borders 3:1. Click targets are at least 32px, and 44px on touch screens. | 2-way | user, 2026-10-29 | accepted |
| D-23 | Amounts: summaries (the overview's colour field, category rows and places) show pesos as whole numbers and dollars with cents. Lists of single transactions keep exact cents in both currencies. | 2-way | user, 2026-10-29 | accepted |
| D-24 | Phones: under 720px the side rail folds into a top bar with the brand and a menu button that names the current screen. Nothing else sits above the overview's answer, so it shows in the first screen. | 2-way | user, 2026-10-29 | accepted |
| D-25 | Category colours: each category keeps one colour in every month, taken from twelve category colours in order of all-time spending; none is red (D-15). Grey is only for "Everything else", and a category without its own colour is counted there. | 2-way | user, 2026-10-29 | accepted |

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
