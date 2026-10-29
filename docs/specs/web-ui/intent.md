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
| web app | The screens you open in a browser to see and manage your money. |
| prototype | A clickable mock-up with made-up data, used to agree on the look before building. |
| design system | The shared colours, type, spacing and parts every screen uses. |
| allowed list | The web addresses the data service accepts browser calls from. |
| renewal pass | What the browser keeps so it can get a new short pass without asking for your password. |
| assistant | The chat screen that answers questions about your money. |

## Open questions
<!-- M tier only: at most 3 question cards here, in the questions.md card format, then one Send list line: owner role and question ids, no names. L tier: cards live in questions.md, so delete this section. -->
### Q-1 · Where should the web app be hosted for staging and prod?
Blocks: G-design · Default: C · Door: 2-way · Owner: owner · Answer-by: 2026-11-05
Context: The app needs a home online. Its address must be on the allowed list before the browser can reach the data. The plan and the repo point different ways.
A. The existing Vercel project: quick preview links per branch, but a second account outside AWS and a second deploy path.
B. AWS Amplify Hosting, the plan's default: stays in your AWS account and supports server rendering, which this app does not need.
C. Static files on S3 behind CloudFront, built by the same pipeline: one account, one deploy, strict security headers. No server rendering.  We recommend C because every data call goes from the browser with your sign-in, so no server is needed.
If no answer by 2026-11-05, we design C.

### Q-2 · When are the assistant screens built?
Blocks: G-design · Default: B · Door: 2-way · Owner: owner · Answer-by: 2026-11-05
Context: The assistant has no server side until Epic 4, and its answer format is not decided. The screens can be designed now either way.
A. Build them now against a fake assistant: everything is clickable soon, but the code guesses an answer format that may change.
B. Design them now in the prototype and the design system; build the code with the Epic 4 contract.  We recommend B because the code would follow a real answer format.
C. Define the assistant's answer format in this spec and build to it: more design work now, and Epic 4 must follow it.
If no answer by 2026-11-05, we plan B.

### Q-3 · How long should the app keep you signed in on a device?
Blocks: G-design · Default: B · Door: 2-way · Owner: owner · Answer-by: 2026-11-05
Context: Sign-in gives the browser a short pass and a renewal pass. Where the renewal pass is kept decides convenience and what a malicious page script could steal.
A. Keep nothing: every reload asks for your password and code. Safest, and tiring.
B. Keep the renewal pass until the tab closes: a reload keeps you in; closing the tab signs you out. No money data is stored in the browser.  We recommend B as the balance for one owner on a personal device.
C. Keep it for 30 days: you rarely sign in, but a stolen pass works for weeks.
If no answer by 2026-11-05, we design B.

Send list: owner · Q-1, Q-2, Q-3
