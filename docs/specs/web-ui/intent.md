---
spec: web-ui
ticket: none
tier: M
status: draft
refs: smart-finances@7ce1ffb
door: 2-way   # the least reversible decision sets it
appetite: 2 weeks; prototype and design system before app code; infra and web ship in one merge, a short window of failed requests is fine
---
# Web UI: design system and screens

<!-- The executor reads this file. Outcome, Why and question cards are plain language: at most 25 words per sentence, no code spans, terms from the Glossary. Other files cite the ids defined here and never restate them. Examples sit in these comments; comments do not count toward the budget. -->

## Request (verbatim)
<!-- Pasted at intake, word for word: the ticket's acceptance criteria, or the user's request when there is no ticket. Remove personal data; keep internal ids. The intent phase turns it into AC rows. Do not edit it after intake. -->
> Let’s start working on the design of it UI

> /spec intake web-ui

Intake answer on scope, word for word:

> Everything but build an artifact so we can refine, improve, iterate, set design system and then plan the frontend architecture

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
- Repo layout: README.md, section "Layout". The web app lives in its stub folder, apps/web.
- Branches: README.md, section "Branches". Feature branches go into qa.
- Real data: .gitignore, block "Real financial data stays local". Prototypes, fixtures and screenshots use synthetic data only.
- Public repo: no personal data, names, account ids or real figures in any committed file, prototype or spec (user rule).
- Security model: docs/threat-model.md, sections "Trust boundaries" and "OWASP Top 10 for LLM Applications 2025". The assistant, citation and tool-trace screens must honour them.
- Architecture records: docs/adr/README.md. A framework or hosting choice that is hard to undo gets an ADR.
- API contract: docs/specs/data-architecture/architecture.md, section "HTTP routes" under Contracts, and its CORS line under Components. The web app consumes it; that spec leaves the client schema to this one.
- Hosting: vercel.json and README.md, section "Status". Git deploys stay off until apps/web builds; then a person points the project root at apps/web.

## Glossary
<!-- Every term the plain-language text and question cards use. One line each. Example row: | page view | One visit to one page or named tab, recorded once. | -->
| Term | Meaning |
|---|---|

## Open questions
<!-- M tier only: at most 3 question cards here, in the questions.md card format, then one Send list line: owner role and question ids, no names. L tier: cards live in questions.md, so delete this section. -->
