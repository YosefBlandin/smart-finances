---
spec: category-suggestions
ticket: none
tier: L
status: draft
refs: smart-finances@e8da84b
door: 2-way
appetite: 1 week; one PR, all parts at once, gaps of minutes are fine
---
# In-browser category suggestions with one-tap approval

<!-- The executor reads this file. Outcome, Why and question cards are plain language: at most 25 words per sentence, no code spans, terms from the Glossary. Other files cite the ids defined here and never restate them. Examples sit in these comments; comments do not count toward the budget. -->

## Request (verbatim)
<!-- Pasted at intake, word for word: the ticket's acceptance criteria, or the user's request when there is no ticket. Remove personal data; keep internal ids. The intent phase turns it into AC rows. Do not edit it after intake. -->
- "Can we build a feature for using AI perhaps a cheap model or something with recommended options for approving the categories in a easy way without pressing too much clicks"
- "Can it be build client side using web assembly?"
- "Spec in-browser"

## Outcome
<!-- What a named user can do or see after this ships, in 2 to 4 plain sentences. -->
The owner opens the review list and sees a suggested category on each payments report row, with two other likely ones beside it. One tap accepts a row. Accept all clears every row that has a suggestion, after one confirmation. The guesses come from the owner's own history and the app's rules, worked out in the browser, so no transaction text leaves the device.

## Why
<!-- The problem today and why it matters now: cost, risk, noise or a request. 2 to 4 bullets, with numbers where you have them. -->
- Since the payments report gained shop names, the review list gets about 20 to 60 rows a month (D-10).
- Each row takes one to three clicks today, and nothing helps the owner choose.
- Most rows repeat a shop or a person the owner has already categorized.
- The owner wants help without sending transactions to an outside service (D-7).

## Acceptance criteria
<!-- Turn the Request into testable rows. One behaviour per row: "When <trigger>, the system shall <response>." (or While, or If ... then). From: ticket, a decision id or user. Ids are append-only; to retire one, start its statement cell with RETIRED. Example row: | AC-1 | When a user opens a page, the system shall write exactly one page-view event for that page. | ticket | -->
| AC | Statement | From |
|---|---|---|
| AC-1 | When the review list shows a payments report row, the system shall show one suggested category when its history, the import rules or the model can name one. | user, D-7, D-9 |
| AC-2 | When a row has a suggestion, the system shall also show up to two other likely categories, each different from the suggestion. | user |
| AC-3 | When the owner taps the suggestion, the system shall save that category and approve the row in one save, and take the row off the list. | user |
| AC-4 | When the owner taps one of the other likely categories, the system shall save that category and approve the row in one save. | user |
| AC-5 | When a row has no suggestion, the system shall show it as today, with the category picker and Approve. | D-7 |
| AC-6 | When the owner chooses Accept all, the system shall first show how many rows will be saved and with which categories, and save only after a second tap. | user |
| AC-7 | When the owner confirms Accept all, the system shall save and approve every row that has a suggestion and leave the rest on the list. | user |
| AC-8 | If some saves fail during Accept all, then the system shall put those rows back with their suggestions and say how many did not save. | user |
| AC-9 | When Accept all covers up to 60 rows, the system shall finish every save without any being refused for too many requests. | D-10 |
| AC-10 | While a review row has keyboard focus, Enter shall accept its suggestion, keys 1 to 3 shall pick the suggestion or the other likely categories, and the up and down arrows shall move between rows. | user |
| AC-11 | When the owner approves, recategorizes or labels a row, the system shall use that choice for the suggestions of similar rows on the list without reloading the page. | D-11 |
| AC-12 | When the owner's own past choice and the import rules disagree for the same shop or person, the system shall suggest the owner's choice. | D-11 |
| AC-13 | While suggestions are worked out, the system shall send no transaction text anywhere; its only new downloads are files from the app's own address. | D-7 |
| AC-14 | The system shall write nothing new to browser storage for suggestions. | D-8 |
| AC-15 | When the review page opens with 60 rows, history and rule suggestions shall appear within 1 second on a mid-range phone. | user |
| AC-16 | If the model file is still downloading, then the system shall show history and rule suggestions first and add model suggestions when ready, without moving rows the owner is looking at. | D-7 |
| AC-17 | The system shall ship the model only if its download is at most about 30 MB and it meets the accuracy bar on synthetic shop names that the rules miss. | D-7, D-12 |
| AC-18 | The review page shall stay within its existing script size budget. | user |
| AC-19 | The system shall show suggestions and their buttons in the owner's language, English or Spanish, and name each button by its category for screen readers. | user |
| AC-20 | When a shop name holds markup or instructions, the system shall show it as plain text, and the suggestion shall depend only on its words. | user |

## No-gos
<!-- What this work will not do, each with a one-line reason or the decision that settled it. -->
- No suggestions on notes or workbook rows: the server does not take choices on them (D-9).
- No outside AI service, no WebAssembly and no change to the script policy (D-7).
- No new server data, routes or stored suggestions: nothing is saved until the owner accepts.
- No category editing on the transactions screen: it stays read-only apart from labels.
- No undo after a save: the server cannot take back an approval, so Accept all asks first (AC-6). A later label still fixes a whole shop or person.
- No new categories and no model training on the owner's device.

## Constraints
<!-- Project rules this change must honour, as pointers (file and section), and hard limits from intake. Never copy the rules here; the brief copies the values it needs. -->
- Real data rule: README.md, section "Layout", and .gitignore, block "Real financial data stays local". Model checks use synthetic rows only.
- ADR rule: docs/adr/README.md. The in-browser model and the security-policy change each get an ADR before code.
- Threat model rule: docs/threat-model.md. A new downloaded asset and a looser script policy are a boundary change; update it before code.
- Public repo rule: docs/specs/spec-profile.md, the comment under the title. No personal data, merchant names from real rows or account ids in tests, fixtures or specs.
- Security policy: the web app's Content-Security-Policy lives in the web middleware; any change is decided in decisions.md and tested.

## Glossary
<!-- Every term the plain-language text and question cards use. One line each. Example row: | page view | One visit to one page or named tab, recorded once. | -->
| Term | Meaning |
|---|---|
| review list | The rows waiting for the owner to approve or recategorize. |
| payments report row | A row imported from the Mercado Pago monthly report. |
| suggestion | The one category the app thinks fits a row best. |
| other likely categories | Up to two more categories that might fit, shown next to the suggestion. |
| approve | Mark a row as checked, so it leaves the review list. |
| Accept all | One action that saves the suggestion of every row that has one, after a confirmation. |
| history | The owner's earlier rows: their own choices and labels, and categories the import rules gave. |
| import rules | The app's existing rules that categorize rows from a shop's name or its store type code. |
| model | A small file that turns a shop name into numbers, so similar names can be compared in the browser. |
| label | A name and category given once to a shop or person, applied to all its rows. |

## Open questions
<!-- M tier only: at most 3 question cards here, in the questions.md card format, then one Send list line: owner role and question ids, no names. L tier: cards live in questions.md, so delete this section. -->
