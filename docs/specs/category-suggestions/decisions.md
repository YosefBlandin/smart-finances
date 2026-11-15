---
spec: category-suggestions
ticket: none
tier: L
status: locked-v1
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
| D-3 | Suggestions are worked out in the browser with a small model run through WebAssembly; no transaction text is sent to an outside AI service. | 2-way | user, 2026-11-15 | superseded-by D-7 |
| D-4 | Access: the agent runs local tests, builds and local model runs on synthetic rows, and may open qa read-only in the built-in browser with the owner's existing sign-in. Anything needing AWS credentials stays with the owner. | 2-way | intake, 2026-11-15 | accepted |
| D-5 | Roles: the agent writes code, commits, pushes the feature branch and opens a draft PR into qa; the owner reviews and merges. | 2-way | intake, 2026-11-15 | accepted |
| D-6 | Stakeholders: only the owner, no fixed date. (default) | 2-way | intake, 2026-11-15 | accepted |
| D-7 | Suggestions are worked out in the browser, from the person's past rows and the existing import rules first, then a small static model with no WebAssembly, only if a measured task shows a download near 30 MB and acceptable accuracy on synthetic shop names; otherwise past rows and rules only. No transaction text leaves the browser and the script policy does not change. Supersedes D-3. | 2-way | user, 2026-11-15 (Q-1, default B) | accepted |
| D-8 | A model file is kept only in the browser's normal download cache, with long cache rules; the app writes nothing new to browser storage. | 2-way | user, 2026-11-15 (Q-2, default A) | accepted |
| D-9 | Every payments report row on the review list gets a suggestion, money sent and received included; notes and workbook rows do not. | 2-way | user, 2026-11-15 (Q-3, default B) | accepted |
| D-10 | Design for 20 to 60 review rows a month. | 2-way | user, 2026-11-15 (Q-4, default B) | accepted |
| D-11 | Suggestions learn from rows the person approved, recategorized or labelled, and from rows the import rules categorized; the person's own choices weigh more. | 2-way | user, 2026-11-15 (Q-5, default B) | accepted |
| D-12 | The model's accuracy bar: on synthetic shop names the rules cannot place, the right category is among the 3 shown for at least 8 of 10, and is the top suggestion for at least 6 of 10. | 2-way | user, 2026-11-15 | accepted |
| D-13 | At DP2 the owner approved AC-1 to AC-20 and the no-gos in intent.md. | 2-way | user, 2026-11-15 | accepted |
| D-14 | Tier stays L although D-7 removed the script policy change: a model file kept in the public repo would be a one-way door (D-23). | 2-way | design, 2026-11-15 | accepted |
| D-15 | The payments import rules (category codes and shop name rules) move to the shared contracts package; the API module re-exports them unchanged, so the browser and the importer use one copy. | 2-way | design, 2026-11-15 | accepted |
| D-16 | History is read in the browser once per visit through the existing transactions data route: the last 12 months in four parallel 3-month reads, 200 rows a page, at most 3 pages each; it is never re-read after a save. | 2-way | design, 2026-11-15 | superseded-by D-24 |
| D-17 | Suggestion levels, strongest first: same recipient key, same cleaned shop name, import rules, shared words, model; within a level the owner's own rows beat rule-categorized rows. | 2-way | design, 2026-11-15 | accepted |
| D-18 | A row gets a suggestion only from a match on its own key or name; the other likely categories come from weaker matches, then from the owner's most used categories for that kind of row. | 2-way | design, 2026-11-15 | accepted |
| D-19 | One tap sends the existing review choice with the category and the approval together; no API change. | 2-way | design, 2026-11-15 | accepted |
| D-20 | Accept all is one client action: a confirmation snapshot, all rows leave at once, saves go 4 at a time, a save refused with a wait of 60 s or less is retried once, and the list is asked again once at the end. No bulk route or bulk action. | 2-way | design, 2026-11-15 | superseded-by D-25 |
| D-21 | Suggestions show only after the history read settles, in space kept for them; model results only fill rows with no suggestion; everything lives in page memory and goes when the page is left. | 2-way | design, 2026-11-15 | superseded-by D-26 |
| D-22 | If the model ships: a static multilingual model cut to Latin-script tokens, at most 256 dimensions, int8, as one hashed built file from the app's own address with an integrity check, loaded after idle on the review page only and run on the main thread in small chunks. | 2-way | design, 2026-11-15 | accepted |
| D-23 | If the model meets the bar, its converted file (at most 30 MB) is committed to the public repo with its licence notice. | 1-way | user, 2026-11-15 (DP3) | accepted |
| D-24 | History is read again on every visit to the review page: the cached copy is dropped when the page is left. Each 3-month range is kept on its own; if one fails, suggestions use what was read and Accept all is hidden for that visit. Supersedes D-16. | 2-way | design, 2026-11-15 (lens review) | accepted |
| D-25 | Accept all closes its confirmation on any other choice, label or list change, and Save works once. Each save is handled on its own: a refusal, an error or 20 s without an answer marks that row failed and the rest go on. It retries once after a wait of 60 s or less, shows the wait, and refetches once at the end. Supersedes D-20. | 2-way | design, 2026-11-15 (lens review) | accepted |
| D-26 | Suggestions show only after the history read settles, in space kept for them. Rows with no suggestion keep that space until the model is ready or off. Model results only fill rows with no suggestion, and nothing outlives the page. Supersedes D-21. | 2-way | design, 2026-11-15 (lens review) | accepted |
| D-27 | After single choices and labels, the list is refetched once, 2 s after the last one, so fast tapping stays within the request limit. | 2-way | design, 2026-11-15 (lens review) | accepted |
| D-28 | At DP3 the owner signed D-23 (commit the model file if it meets the bar) and accepted D-14, D-15, D-17 to D-19, D-22 and D-24 to D-27 in bulk; the feature door becomes 1-way because of D-23. | 2-way | user, 2026-11-15 | accepted |
| D-29 | At DP4 the owner approved the plan in pr-smart-finances.md and release.md and kept D-5: commit on the feature branch, push it, open a draft PR into qa. | 2-way | user, 2026-11-15 | accepted |

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

### D-23 options
**Options**
- A. Do nothing: no model; suggestions come from history and rules only (the D-7 fallback).
- B. Commit the converted file, at most 30 MB, with its licence notice; the build serves it as a hashed asset. ✓
- C. Convert at build time from a pinned upstream file with a checksum; nothing large in the repo, but every build downloads from an outside host and fails when it is down.
- D. Git LFS: keeps clones small, but Amplify builds need LFS set up, and that is unchecked.

**Why**: B adds no outside host to builds and needs no new build setup; the file only lands if the measured bar and size pass (D-7, D-12).
**Cost / accepted risk**: up to 30 MB stays in git history for good, even after a revert; every fresh clone downloads it. Removing it later needs a history rewrite.
**Confirm by**: the gate task records the file size and the evaluation result in the PR body; a test fails if the file is over 30 MB.
