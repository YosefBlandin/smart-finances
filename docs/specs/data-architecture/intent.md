---
spec: data-architecture
ticket: none
tier: L
status: draft
refs: smart-finances@7ce1ffb
door: 1-way                # data store, keys and access rules are hard to undo once real data is loaded
appetite: about 1 week from intake to handoff; one repo, all parts deploy together on merge, gaps of minutes are fine
---
# Data architecture: model, store, access patterns, ingestion and auth

<!-- The executor reads this file. Outcome, Why and question cards are plain language: at most 25 words per sentence, no code spans, terms from the Glossary. Other files cite the ids defined here and never restate them. Examples sit in these comments; comments do not count toward the budget. -->

## Request (verbatim)
<!-- Pasted at intake, word for word: the ticket's acceptance criteria, or the user's request when there is no ticket. Remove personal data; keep internal ids. The intent phase turns it into AC rows. Do not edit it after intake. -->
> Now what else we need to do since we can test this on an uI

> We haven't run the phase for the architecture of projects and DB right?

> /spec intake data-architecture

## Outcome
<!-- What a named user can do or see after this ships, in 2 to 4 plain sentences. -->

## Why
<!-- The problem today and why it matters now: cost, risk, noise or a request. 2 to 4 bullets, with numbers where you have them. -->

## Acceptance criteria
<!-- Turn the Request into testable rows. One behaviour per row: "When <trigger>, the system shall <response>." (or While, or If ... then). From: ticket, a decision id or user. Ids are append-only; to retire one, start its statement cell with RETIRED. Example row: | AC-1 | When a user opens a page, the system shall write exactly one page-view event for that page. | ticket | -->
| AC | Statement | From |
|---|---|---|

## No-gos
<!-- What this work will not do, each with a one-line reason or the decision that settled it. -->

## Constraints
<!-- Project rules this change must honour, as pointers (file and section), and hard limits from intake. Never copy the rules here; the brief copies the values it needs. -->
- Committed data rule: README.md, section "Layout". Tests, fixtures and examples use synthetic data only.
- Local data rule: .gitignore, block "Real financial data stays local". Real files and anything derived from them stay under data/real.
- ADR rule: docs/adr/README.md. Each accepted one-way decision gets its own ADR, starting with 0004 access patterns; ADR 0003 is revisited, not edited in place.
- Threat model rule: docs/threat-model.md. Update assets, trust boundaries and STRIDE rows for every new store, upload path and identity.
- Public repo: spec-profile.md, section "Rules to honour". No personal data, names, account ids or real figures in committed files.
- Agent access is limited by D-3; anything that changes AWS is a human action (spec-profile.md, "Human-only actions").

## Glossary
<!-- Every term the plain-language text and question cards use. One line each. Example row: | page view | One visit to one page or named tab, recorded once. | -->
| Term | Meaning |
|---|---|
| source | Where a row came from: the payments app report, the old notes log, or a monthly spreadsheet. |
| period | The month or span of time a file covers. |
| import | Loading a file's rows into the app's single list of transactions. |
| review list | The screen of imported rows that need the owner's look, such as unclear categories or possible duplicates. |
| review choice | The owner's decision on a row: approve it, change its category, or confirm it is a duplicate. |
| duplicate | The same payment appearing twice, in one source or in two. |
| dollar view | A report that shows every amount in dollars, converted with a monthly rate the owner picks. |
| savings rate | The share of income kept rather than spent; it needs one currency. |
| second-account test | A security check that a second test sign-in cannot see the first sign-in's data. |
| budget alarm | A warning that fires when cloud spending passes a set limit. |
| administrator rights | Permission to read, change or delete everything in a cloud account. |
