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
- Real data rule: README.md, section "Layout", and .gitignore, block "Real financial data stays local". Model checks use synthetic rows only.
- ADR rule: docs/adr/README.md. The in-browser model and the security-policy change each get an ADR before code.
- Threat model rule: docs/threat-model.md. A new downloaded asset and a looser script policy are a boundary change; update it before code.
- Public repo rule: docs/specs/spec-profile.md, the comment under the title. No personal data, merchant names from real rows or account ids in tests, fixtures or specs.
- Security policy: the web app's Content-Security-Policy lives in the web middleware; any change is decided in decisions.md and tested.

## Glossary
<!-- Every term the plain-language text and question cards use. One line each. Example row: | page view | One visit to one page or named tab, recorded once. | -->
| Term | Meaning |
|---|---|

## Open questions
<!-- M tier only: at most 3 question cards here, in the questions.md card format, then one Send list line: owner role and question ids, no names. L tier: cards live in questions.md, so delete this section. -->
