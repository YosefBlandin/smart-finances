---
spec: data-architecture
ticket: none
tier: L
status: executing
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
The owner signs in, uploads their files, and gets one clean list of transactions stored in the cloud. Uploading a file again never counts anything twice. Monthly totals, the review list, export and delete-all all read from that one list. The web screens can then be built on a stable set of requests.

## Why
<!-- The problem today and why it matters now: cost, risk, noise or a request. 2 to 4 bullets, with numbers where you have them. -->
- The clean history exists only as a file on one laptop, so no screen or assistant can read it yet.
- The planned dashboard, review list and assistant all need the same stored data and the same sign-in.
- How data is filed and who may read it is hard to change once real data is loaded.
- Research found four gaps: no owner marker, review work lost on re-import, stale rows after a correction, and no budget alarm.

## Acceptance criteria
<!-- Turn the Request into testable rows. One behaviour per row: "When <trigger>, the system shall <response>." (or While, or If ... then). From: ticket, a decision id or user. Ids are append-only; to retire one, start its statement cell with RETIRED. Example row: | AC-1 | When a user opens a page, the system shall write exactly one page-view event for that page. | ticket | -->
| AC | Statement | From |
|---|---|---|
| AC-1 | If a data request arrives without a valid sign-in, then the system shall refuse it and return no data. | user |
| AC-2 | When a signed-in person reads or changes data, the system shall act only on items filed under that person, taken from the sign-in and never from the request. | D-6 |
| AC-3 | When a second test account signs in, the system shall show it none of the first account's rows, imports, review choices or files. | D-6 |
| AC-4 | When the owner uploads a payments report, notes log, budget workbook or synthetic CSV, the system shall import its rows and record the import with its status and row counts. | user |
| AC-5 | If some rows in an uploaded file cannot be read, then the system shall import the rest and list each skipped row with its reason on the import record. | user |
| AC-6 | If an uploaded file is of an unknown kind, too large or broken as a whole, then the system shall store none of its rows and record why. | user |
| AC-7 | When the same file is uploaded twice, the system shall store its rows once, and totals shall not change. | user |
| AC-8 | When a corrected file for the same source and period is uploaded, the system shall replace the earlier rows from that source and period. | D-9 |
| AC-9 | When the owner undoes an import, the system shall restore the rows as they were before that import. | D-9 |
| AC-10 | When the owner lists transactions, the system shall filter them by month range, category, kind and text, sort them, and return them a page at a time. | user |
| AC-11 | When the owner asks for monthly totals, the system shall return totals by month, category and currency equal to the sum of the counted rows. | user |
| AC-12 | When the same change is delivered to the totals twice, the system shall leave the totals unchanged. | user |
| AC-13 | When the owner opens the review list, the system shall return every row still marked for review or as a possible duplicate, with its reason. | user |
| AC-14 | When the owner approves a payments report row or changes its category, the system shall keep that choice after later imports of the same source. | D-8 |
| AC-15 | If the owner makes a review choice on a notes log or budget workbook row, then the system shall refuse it and say to correct the source file. | D-8 |
| AC-16 | When the owner asks for the dollar view, the system shall convert pesos with the owner's rate for each month and name any month without a rate. | D-7 |
| AC-17 | When the owner exports all data, the system shall return every row with review choices applied, and text that looks like a spreadsheet formula made harmless. | user |
| AC-18 | When the owner deletes all data, the system shall remove every row, import, review choice, rate and uploaded file filed under that person. | user |
| AC-19 | While data is stored, the system shall keep it encrypted and the uploaded files private. | user |
| AC-20 | When the local import runs on the same files, the system shall produce the same rows and pass the same checks as before this change. | D-2 |

## No-gos
<!-- What this work will not do, each with a one-line reason or the decision that settled it. -->
- No web screens: the dashboard, review list and import screens are the next spec, built on these requests.
- No assistant, knowledge base or vector store: plan Epic 4, with its own decision on chunking.
- No net worth: the sources give no account balances, so it would be a guess.
- No automatic merchant name cleanup: text search over descriptions covers lookups for now.
- No cloud pull from the payments app: its access key stays in the owner's own shell.
- No sharing or invite features, even though items are filed per person.
- No deploy or promotion by the agent: D-3 and D-4.

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
