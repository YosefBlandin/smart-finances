---
spec: mercadopago-enrichment
ticket: none
tier: M
status: executing
refs: smart-finances@f9836e0
door: 1-way   # names and labels stored on the server need a cleanup step to undo (intake Q3)
appetite: 5 days; all parts ship together through CI, which deploys the API stacks before the web app; gaps of minutes are fine
---
# Mercado Pago enrichment: merchant names, category codes and name-once recipient labels

<!-- The executor reads this file. Outcome, Why and question cards are plain language: at most 25 words per sentence, no code spans, terms from the Glossary. Other files cite the ids defined here and never restate them. Examples sit in these comments; comments do not count toward the budget. -->

## Request (verbatim)
<!-- Pasted at intake, word for word: the ticket's acceptance criteria, or the user's request when there is no ticket. Remove personal data; keep internal ids. The intent phase turns it into AC rows. Do not edit it after intake. -->
Owner, 2026-11-14, with a screenshot of a review row that showed only an amount and "payment / available_money":

> In mercado pago we usually have the name to the person we did the transfer or more useful information, I need more info since it's difficult for me to guess based on the amount only. Let's brainstorm ideas in how to improve this and if this data is included in MP reports

> And why everyting of october looks uncategorized

> But that means consulting each transaction which can be thousand of them, can we do it in bulk?

The owner then chose "Spec it first" for this proposal from the same conversation:

1. Sync enriches while it downloads: two payment searches per month, joined by operation id, saved as extra columns in the monthly report file (merchant name, category code, recipient key), so a qa upload carries them.
2. The importer fills the merchant from those columns, maps category codes to categories, then runs the keyword rules on the merchant name.
3. People and bank accounts are named once: a keyed hash of the Mercado Pago id or bank account number is the recipient key, and a review action applies a name and category to every past and future row with that key. The payer name column covers money received.
4. Third-party names reach the qa data store, so the threat model is updated; ID numbers, emails and phones are never kept.

## Outcome
<!-- What a named user can do or see after this ships, in 2 to 4 plain sentences. -->
After a sync, the owner sees the shop or app name on most Mercado Pago purchases and the sender's name on money received. Most purchases get a category on their own. A person or bank account without a name can be labeled once, which names, categorizes and approves all of its rows. Purchases still without a category wait on the review list.

## Why
<!-- The problem today and why it matters now: cost, risk, noise or a request. 2 to 4 bullets, with numbers where you have them. -->
- In October 2026, 98% of spending shows as Uncategorized, because the monthly report has no merchant or person names.
- To review a row, the owner has only an amount and a date, so each guess is slow and often wrong.
- A probe on 2026-11-14 found the payments service names the merchant for 49 of 73 October expenses, in two searches for the month.
- Transfers to people and to bank accounts carry no name there, only a stable id, so they need a name given once.

## Acceptance criteria
<!-- Turn the Request into testable rows. One behaviour per row: "When <trigger>, the system shall <response>." (or While, or If ... then). From: ticket, a decision id or user. Ids are append-only; to retire one, start its statement cell with RETIRED. Example row: | AC-1 | When a user opens a page, the system shall write exactly one page-view event for that page. | ticket | -->
| AC | Statement | From |
|---|---|---|
| AC-1 | When sync saves a month's report, the system shall add to each operation the payments service returns its merchant name, category code and recipient key. | user |
| AC-2 | When an enriched report is imported, locally or on qa, the system shall show the merchant name on each Mercado Pago row that has one. | user |
| AC-3 | When an imported row's category code or merchant name matches a category rule, the system shall set that category at import. | user |
| AC-4 | When a report row is money received, the system shall show the sender's name from the report. | D-8 |
| AC-5 | If a Mercado Pago purchase is still Uncategorized after import, then the system shall put it on the review list. | D-6 |
| AC-6 | When the owner labels a recipient with a name and a category, the system shall apply both to every stored row with that recipient key and approve those rows, in one action. | D-7 |
| AC-7 | When a later import brings a row whose recipient already has a label, the system shall show that row with the label's name and category, approved. | D-7 |
| AC-8 | When the owner deletes everything, the system shall remove recipient labels and stored names together with the rest of their data. | D-8 |
| AC-9 | If an enrichment value holds a character the report file cannot carry, then the system shall replace that character and still import the file. | user |
| AC-10 | The system shall never store or log a payer's email, phone or ID number, and shall never write a person's or shop's name to a log. | D-8 |

## No-gos
<!-- What this work will not do, each with a one-line reason or the decision that settled it. -->
- No automatic upload from sync to qa: the owner uploads by hand, and a script sign-in would need the owner's second factor.
- No names for transfers to bank accounts: the payments service does not return them; labeling covers them.
- No import of the PDF account statement: the payments service names purchases, and labels cover the rest.
- No labels for Notion or Excel rows: review choices stay Mercado Pago only, as today.
- No screen to list, rename or delete labels: labeling a recipient again replaces its label.
- No customer-managed encryption keys: planned for a later epic in the threat model.

## Constraints
<!-- Project rules this change must honour, as pointers (file and section), and hard limits from intake. Never copy the rules here; the brief copies the values it needs. -->
- Public repo rule: docs/specs/spec-profile.md, "Rules to honour", last line, and its header comment. Fixtures and tests use made-up names only.
- Real data stays local: README.md, section "Layout", and .gitignore, block "Real financial data stays local".
- One ADR per decision: docs/adr/README.md. A new stored data kind or a keyed-hash secret gets its ADR.
- Threat model: docs/threat-model.md, updated when a trust boundary or data store changes. Third-party names in the data store qualify.
- Human-only actions: docs/specs/spec-profile.md, "Human-only actions". Every run that uses the Mercado Pago token is the owner's.
- Privacy of logs: the brief's Global constraints, first line. Logs carry ids and counts, never names.

## Glossary
<!-- Every term the plain-language text and question cards use. One line each. Example row: | page view | One visit to one page or named tab, recorded once. | -->
| Term | Meaning |
|---|---|
| review list | The screen of rows waiting for the owner to pick a category or approve. |
| merchant name | The shop or app name the payments service gives for a purchase. |
| category code | A four-digit store type the payments service gives, for example restaurants. |
| recipient | The person or bank account that money was sent to or received from. |
| recipient label | A name and category the owner gives a recipient once, applied to all its rows. |
| qa data store | The online database of the qa version of the app. |
| restore window | The 35 days during which deleted data can still be recovered from backups. |
| payments service | The Mercado Pago service that lists each payment with its details. |
| sync | The local command that downloads each month's Mercado Pago report. |
| enriched report | A monthly report file with merchant name, category code and recipient key added. |
| recipient key | A scrambled, stable code for a recipient, so the same person always matches without storing their account id. |

## Open questions
<!-- M tier only: at most 3 question cards here, in the questions.md card format, then one Send list line: owner role and question ids, no names. L tier: cards live in questions.md, so delete this section. -->
| Q | Answer | Date | Who |
|---|---|---|---|
| Q-1 | → D-6 | 2026-11-14 | owner |
| Q-2 | → D-7 | 2026-11-14 | owner |
| Q-3 | → D-8 | 2026-11-14 | owner |

No question is open. The owner answered all three directly, so the cards were not sent.
