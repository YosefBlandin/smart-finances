---
spec: web-ui
ticket: none
tier: L
status: locked-v2
refs: smart-finances@903321c
door: 1-way   # D-61: open sign-up stores strangers' data
appetite: about 5 weeks, one release (D-68); prototype and design system before app code; infra and web ship in one merge, a short window of failed requests is fine
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
Anyone can create an account, check their email, set up an authenticator and start bringing in their own files. Each person then sees, first, what they kept this month against their typical month. They can fix the rows in to review, look through their transactions and erase their data, in English or Spanish. Nobody sees anyone else's money. The look is settled first in the prototype and the design system, and the web app is built from them.

## Why
<!-- The problem today and why it matters now: cost, risk, noise or a request. 2 to 4 bullets, with numbers where you have them. -->
- The data service will soon hold every import, but nothing shows that money to a person yet.
- The brand speaks to future savers, so they should be able to use it with their own money, not only see it (D-61).
- Every screen must explain itself in plain words, because strangers arrive with no help (D-8).
- Keeping the session on the web server means a hostile script on the page cannot steal it (D-62).
- Changing a look in the prototype is cheaper than changing built screens (D-4).

## Acceptance criteria
<!-- Turn the Request into testable rows. One behaviour per row: "When <trigger>, the system shall <response>." (or While, or If ... then). From: ticket, a decision id or user. Ids are append-only; to retire one, start its statement cell with RETIRED. Example row: | AC-1 | When a user opens a page, the system shall write exactly one page-view event for that page. | ticket | -->
| AC | Statement | From |
|---|---|---|
| AC-1 | When a person enters a valid email, password and authenticator code, the system shall sign them in and open the overview. | user |
| AC-2 | When a person opens the overview, the system shall show first what they kept this month against their typical month, as one headline sentence. | D-18 |
| AC-3 | RETIRED → AC-11: red is now also allowed for errors (D-63). | D-13 |
| AC-4 | When a person picks the other language, the system shall show every screen in it without signing them out or losing the current screen. | D-11 |
| AC-5 | When a person sends a file on the imports screen, the system shall show the import's status until it ends, and list each row that failed with its reason. | D-3 |
| AC-6 | When a person filters, sorts or pages the transactions, the system shall ask the data service for that page and show only what it returns. | D-3 |
| AC-7 | When a person asks to erase all their data, the system shall require the typed word DELETE, say it can be restored for 35 days, and show the counts erased. | D-3 |
| AC-8 | While a screen is loading, empty, failed or only partly imported, the system shall say so in plain words and offer the next step, never a blank screen. | D-8 |
| AC-9 | When the system shows imported text or an assistant answer, it shall show it as plain text, so no link, image or script inside it runs. | D-3 |
| AC-10 | When a person uses only the keyboard, the system shall reach every action in order and show where the focus is. | D-22 |
| AC-11 | If a month's spending is more than its earnings, then the system shall show the overspend in red with one plain sentence, and no other money figure on the screen in red. | D-63 |
| AC-12 | When a person signs up with an email and a password, the system shall send a code to that email and create the account only after the code is entered. | D-61 |
| AC-13 | When a new account signs in for the first time, the system shall require authenticator setup before it shows any money screen. | D-61 |
| AC-14 | When a person creates an account, the system shall first show the privacy notice and the terms, and record that the person accepted them. | D-61 |
| AC-15 | When a signed-in person opens any screen or makes any change, the system shall read or change only that person's own data. | D-61 |
| AC-16 | While a person is signed in, the system shall hold the session on the web server, and the browser shall keep nothing a page script can read to act as that person. | D-62 |
| AC-17 | If one person or one address sends more requests than its limit, then the system shall refuse the extra ones with a plain message, and other people shall not be slowed. | D-61 |
| AC-18 | When a person deletes their account, the system shall erase their data, end every session and confirm what was removed. | D-61 |
| AC-19 | If sign-ups from one address pass its limit, or a sign-up fails the check for automated sign-ups, then the system shall refuse it with a plain message. | D-67 |
| AC-20 | When a person forgets their password, the system shall let them set a new one after a code sent to their email, and still ask for their authenticator code. | D-66 |

## No-gos
<!-- What this work will not do, each with a one-line reason or the decision that settled it. -->
- Net worth: hidden until a source sends balances (D-18).
- Replacing or updating the old app on main: it is retired and its hosting is off (D-2).
- Investment advice, product picks or moving money: those need licences the app does not have.
- Bank connections: people bring files; no account is linked to a bank.
- Keeping money data or chats in the browser: a hostile page script could read them.
- A demo with made-up data: real accounts replace it (D-61).
- Resetting a lost authenticator on your own: the sign-in service has no such step, so the person writes to the contact address and the owner resets it.
- The assistant's server side and its screen code: both come with Epic 4; its screens are only designed now (D-46).

## Constraints
<!-- Project rules this change must honour, as pointers (file and section), and hard limits from intake. Never copy the rules here; the brief copies the values it needs. -->
- Repo layout: README.md, section "Layout". The web app lives in its stub folder, apps/web.
- Branches: README.md, section "Branches". Feature branches go into qa.
- Real data: .gitignore, block "Real financial data stays local". Prototypes, fixtures and screenshots use synthetic data only.
- Public repo: no personal data, names, account ids or real figures in any committed file, prototype or spec (user rule).
- Security model: docs/threat-model.md, sections "Trust boundaries" and "OWASP Top 10 for LLM Applications 2025". The assistant, citation and tool-trace screens must honour them.
- Architecture records: docs/adr/README.md. A framework or hosting choice that is hard to undo gets an ADR.
- API contract: docs/specs/data-architecture/architecture.md, section "HTTP routes" under Contracts, and its CORS line under Components. The web app consumes it; that spec leaves the client schema to this one.
- Hosting: vercel.json and README.md, section "Status". The Vercel project stays off (D-45).
- Threat model: docs/threat-model.md, sections "Out of scope" and B1. Open sign-up reverses "single user" and "self sign-up off"; the model is updated before sign-up opens.
- Sign-in pool and data service: owned by the data-architecture spec (its decisions on one owner, sizing and limits). Changes to them are recorded there too.

## Glossary
<!-- Every term the plain-language text and question cards use. One line each. Example row: | page view | One visit to one page or named tab, recorded once. | -->
| Term | Meaning |
|---|---|
| web app | The screens you open in a browser to see and manage your money. |
| prototype | A clickable mock-up with made-up data, used to agree on the look before building. |
| design system | The shared colours, type, spacing and parts every screen uses. |
| allowed list | The web addresses the data service accepts browser calls from. |
| session cookie | What the browser keeps so the web server knows it is you. Page scripts cannot read it. |
| web server | The part of the web app that runs on our side, signs you in and fetches your data. |
| account | One person's sign-in and everything they stored. Nobody else can see it. |
| sign-up | Creating an account with your email, a password and an authenticator. |
| privacy notice | The page that says what is stored, where, for how long, and how to remove it. |
| assistant | The chat screen that answers questions about your money. |
| overview | The first screen after sign-in: what you kept, what is waiting, where it went. |
| typical month | The average of your previous six months. |
| to review | Imported rows flagged for a look, such as a possible duplicate. |
| import | One file you bring in, from its upload until it is done or failed. |
