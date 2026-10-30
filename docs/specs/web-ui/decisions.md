---
spec: web-ui
ticket: none
tier: L
status: draft
---
# Web UI: design system and screens: decisions

<!-- The single home for every decision. Other files cite the id; a brief may copy the one-line text verbatim. Row: id, decision, door (1-way or 2-way), source and date (intake, user, stakeholder:role or design), status (proposed, accepted, superseded-by plus the new id, or RETIRED → the new id). -->
<!-- A late answer after lock never edits a row: add a new decision that supersedes the old one, then run spec-lint.mjs with --impact on the old id to find the tasks and tests that cite it. -->
<!-- Example rows:
| D-1 | Record page views as a new event type in the existing event log. | 2-way | stakeholder:security, 2026-10-29 | superseded-by D-60 |
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
| D-8 | Audience: the brand speaks to future savers, not only the owner; screens need onboarding and plain words. Sign-up stays off for now, so strangers meet it through a demo account. | 2-way | user, 2026-10-29 | superseded-by D-61 |
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
| D-26 | The kept bar in the overview's colour field labels its parts: what you spent and what you kept, each with its share, plus a marker for what a typical month keeps. In a bad month it labels where earnings ran out and how much you went over. Its texture is still open. | 2-way | user, 2026-10-29 | accepted |
| D-27 | The kept bar has no texture. The part that is the answer is solid: what you kept in a good month, the overspend in a bad one. The rest is a pale fill at 3:1 against the field. Narrows D-17: this bar carries numbers but is not drawn as bands. | 2-way | user, 2026-10-29 | accepted |
| D-28 | In the colour field, the typical month appears in the comparison sentence and at the bar's marker only. The right-hand list keeps Earned and Spent; when an unusual month moves the average, one short line under the bar says so. | 2-way | user, 2026-10-29 | accepted |
| D-29 | Spent in the colour field stays in pesos, with what was spent in dollars as a second line. The user accepted that it can't be compared at a glance with Earned, which is in dollars. | 2-way | user, 2026-10-29 | accepted |
| D-30 | Percentages in the colour field are whole numbers (32%, not 31.7%); the comparison sentence keeps its exact points. | 2-way | user, 2026-10-29 | accepted |
| D-31 | Earned in the colour field shows pesos first, at the month's dollar rate, with the dollars actually received as a second line ("USD 1,922.00 at ARS 1,375.00 per dollar"). A month with no rate shows dollars only and says it has no rate yet. Earned and Spent can now be compared in pesos, which removes the cost accepted in D-29. | 2-way | user, 2026-10-29 | accepted |
| D-32 | Amber leaves the category colours and means attention only. A purple takes its place, so all eleven coloured categories keep their own colour, and light blue gets slightly deeper in light mode. Every category colour now meets 3:1 against the page in both themes. The logo keeps its amber band. | 2-way | user, 2026-10-29 | accepted |
| D-33 | The khaki category colour becomes a muted plum, so the eleventh category no longer looks like the grey of uncoloured categories and "Everything else" on the light page. It still meets 3:1 in both themes. | 2-way | user, 2026-10-29 | accepted |
| D-34 | Lists mark a category with the same solid square as the overview's category rows, not a striped mark, so one category has one mark everywhere and its colour shows at list size. | 2-way | user, 2026-10-29 | accepted |
| D-35 | Desktop rail: the rail stays in view while the page scrolls, with the account area pinned to its bottom, so the nav and Sign out are always on screen. | 2-way | user, 2026-10-29 | accepted |
| D-36 | Nav groups: Money (Overview, Transactions, To review, Imports, Dollar rates, Ask), Account (Your data) and Prototype (Sign-in flow, Design system). The one-link Assistant group goes; Sign-in flow moves to Prototype because it is not a screen of the real app. | 2-way | user, 2026-10-29 | accepted |
| D-37 | Language leaves the nav and joins the account area as one row that names the other language ("Español" in English, "English" in Spanish), beside the language icon and shaped like the Sign out row. The two-way switch goes. | 2-way | user, 2026-10-29 | accepted |
| D-38 | The account area says who is signed in (the address, then "Authenticator on" in small muted text), then the language row and Sign out as a plain row with no border, so nothing in the rail is boxed. | 2-way | user, 2026-10-29 | accepted |
| D-39 | The current screen is marked by a 2px ink line beside its bold ink label, with no fill and no shadow (16.1:1 light, 13.9:1 dark against the rail). Hover keeps the white fill. | 2-way | user, 2026-10-29 | accepted |
| D-40 | The wordmark is set at 700, not 800, so 800 stays for the display figure (D-22). The environment tag ("qa") is a 12px uppercase label in Chivo, not Chivo Mono (D-16). | 2-way | user, 2026-10-29 | accepted |
| D-41 | Nav group labels sit 24px below the group above and 8px above their first link, so each label heads its own group. | 2-way | user, 2026-10-29 | accepted |
| D-42 | The Spanish nav label for dollar rates is "Cotizaciones", which fits on one line; the screen title keeps "Cotización del dólar". | 2-way | user, 2026-10-29 | accepted |
| D-43 | The top bar from D-24 applies up to 960px, not 720px, so tablets get it too. Its menu opens as a panel over the page, under the bar, without moving the page; the button shows a close mark while open and is 44px tall. Narrows D-24. | 2-way | user, 2026-10-29 | accepted |
| D-44 | The top bar's menu button carries the amber "To review" count beside the screen name, so it shows from every screen. The user accepted one more mark in the bar than D-24 allowed. | 2-way | user, 2026-10-29 | accepted |
| D-45 | Hosting for staging and prod: AWS Amplify Hosting, the plan's default, in the same AWS account. The user chose it over static files on S3 and CloudFront, accepting a server-rendering host the app does not need. An ADR records the framework and host at design. | 2-way | user, 2026-10-30 (Q-1) | accepted |
| D-46 | Assistant screens: designed now in the prototype and the design system; their code is built in Epic 4 against its real answer format. | 2-way | user, 2026-10-30 (Q-2) | accepted |
| D-47 | Sign-in on a device: the renewal pass is kept only until the tab closes, so a reload keeps you in and closing the tab signs you out. No money data or chat is stored in the browser. | 2-way | user, 2026-10-30 (Q-3) | accepted |
| D-48 | DP2: the user approved AC-1 to AC-10 and the no-gos as written. | 2-way | user, 2026-10-30 | accepted |
| D-49 | Framework: a Vite, React and TypeScript single-page app in apps/web, built to static files. Next.js is not used, so the content policy can forbid inline scripts. Packages: vite, @vitejs/plugin-react, react, react-dom, react-router, typescript. | 2-way | design, 2026-10-30 | superseded-by D-62 |
| D-50 | Hosting wiring: per stage, a web host stack makes the Amplify app and branch with no Git connection and publishes the web address; a web stack, deployed last, uploads the build and starts the Amplify deployment through one custom resource. CI stays the only deploy path. | 2-way | design, 2026-10-30 | superseded-by D-65 |
| D-51 | One build for every stage: the web stack writes config.json (stage, region, API address, pool and client ids) into the bundle; the app reads it at start. | 2-way | design, 2026-10-30 | superseded-by D-65 |
| D-52 | Sign-in uses only the sign-in part of the Amplify JavaScript library (package aws-amplify), with its token storage set to session storage (D-47). | 2-way | design, 2026-10-30 | superseded-by D-62 |
| D-53 | API calls send the access token as a bearer token. The API's audience check accepts it through the token's client id; a person confirms it on qa. | 2-way | design, 2026-10-30 | proposed |
| D-54 | Reads go through one fetch wrapper and TanStack Query (package @tanstack/react-query), paging by the API's cursor. The web keeps its own typed copy of the HTTP routes; the field, kind and category lists come from browser-safe API modules exported by the API package. | 2-way | design, 2026-10-30 | proposed |
| D-55 | Routes and words: client routes per screen with month, view and filters in the address; English and Spanish catalogues with the same keys, checked by a test; the language choice kept in local storage as a preference. | 2-way | design, 2026-10-30 | proposed |
| D-56 | Demo mode: the same screens under /demo, fed by bundled synthetic data, with no sign-in and every change disabled with a plain note. It replaces a shared demo sign-in, which would mean publishing an authenticator key and letting anyone erase the data. | 2-way | design, 2026-10-30 | superseded-by D-61 |
| D-57 | Styling and charts: the prototype's CSS custom properties copied as tokens, with CSS modules; no Tailwind and no shadcn. Charts are drawn by hand in SVG, each with a table alternative; no chart library. | 2-way | design, 2026-10-30 | proposed |
| D-58 | Fonts and icons are bundled: Chivo and Chivo Mono from @fontsource packages, icons from @tabler/icons-react. No font or icon service is called at run time. | 2-way | design, 2026-10-30 | proposed |
| D-59 | Tests: Vitest for logic and parts, Playwright browser tests on the fixtures for every screen, keyboard order and the content policy. Both run in CI before AWS credentials, and the root test command runs them. Packages: vitest, @playwright/test. | 2-way | design, 2026-10-30 | proposed |
| D-60 | Tier L, superseding D-1: sign-up and server-held sessions change who may have an account and the sign-in pool, so the spec covers access control. | 2-way | user, 2026-10-30 | accepted |
| D-61 | Sign-up is in this spec: anyone can create an account and store their own data, superseding the sign-up and demo-account parts of D-8. It replaces the demo mode in D-56. See D-61 options. | 1-way | user, 2026-10-30 | accepted |
| D-62 | Next.js with server rendering, and the session held by the web server in cookies page scripts cannot read; the browser never holds a token. Supersedes D-49 and D-52. | 2-way | user, 2026-10-30 | accepted |
| D-63 | Red is also allowed for errors and failed statuses (error notes, failed or expired imports, a wrong password). Among money figures it stays only on the one bad figure. Narrows D-13. | 2-way | user, 2026-10-30 | accepted |
| D-64 | The web PR may merge into qa once it is green, before data PRs 2 and 3. Screens whose routes are missing show the failed state; their qa checks, and any promotion to staging, wait for those PRs. | 2-way | user, 2026-10-30 | accepted |
| D-65 | The web app and its web server run on Amplify Hosting connected to the GitHub repo, which builds and deploys it per branch (qa, staging, main). The user accepted a second deploy path, a GitHub connection, run-time settings written at build time, and no streaming. Supersedes D-50 and D-51. | 2-way | user, 2026-10-30 (Q-4) | accepted |
| D-66 | Sign-up and sign-in use our own screens from the prototype; the web server runs each step with the sign-in service itself (password, email code, authenticator setup, code). The user accepted the extra code and its security review. | 2-way | user, 2026-10-30 (Q-5) | accepted |
| D-67 | Sign-up is open to anyone from the start, with no invitation step. The user accepted fake accounts, their cost and load, so abuse limits must ship with sign-up. | 2-way | user, 2026-10-30 (Q-6) | accepted |
| D-68 | One release of about five weeks; sign-up, privacy pages and limits ship with the web app. Replaces the two-week appetite. | 2-way | user, 2026-10-30 (Q-7) | accepted |

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

### D-61 options
**Options**
- A. Do nothing: owner only, sign-up stays off; visitors cannot try the app.
- B. Demo mode with made-up data and no sign-in (D-56): visitors see the screens, nobody else stores data.
- C. Self sign-up for anyone, each person seeing only their own data. ✓

**Why**: the brand speaks to future savers (D-8), and the user wants them to use it with their own money, not only see it.
**Cost / accepted risk**: strangers' financial data is stored, which brings privacy duties, abuse and cost limits, email delivery, and changes to the sign-in pool owned by the data-architecture spec. Closing sign-up later still leaves their accounts and data to keep or erase.
**Confirm by**: a test that a new account sees no other account's data, and a qa check that sign-up, email check and authenticator setup work end to end.

