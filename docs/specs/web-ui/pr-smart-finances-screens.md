---
spec: web-ui
ticket: none
tier: L
status: draft
---
# Web UI: design system and screens: brief for smart-finances (PR 4 of 4, screens)

<!-- The executor's main document. It must stand alone: copy values in, and link only to sections a task cites. At most 6k tokens; comments do not count. Required reading (intent.md, this file and its Read first sections) stays under 15k. Before the lock, the cold-read dry run must find zero "cannot start" items. -->

- Goal: a signed-in person sees the overview, transactions, review, imports, rates and their data, and can erase their data or delete their account.
- Implements: AC-2, AC-4 to AC-11, AC-15, AC-17, AC-18, D-18 to D-21, D-26 to D-31, D-82, D-85, D-86, D-101, D-104, D-114
- Spec folder: /home/user/smart-finances/docs/specs/web-ui in a cloud session; locally <repo root>/docs/specs/web-ui. Read and write the spec there, on the branch named under Branch, never a copy elsewhere.
- Refs: smart-finances at the sha in intent.md refs. Before the first task: `git fetch origin qa feature/web-ui`, then `node ~/.claude/skills/spec/scripts/drift.mjs docs/specs/web-ui --strict` (exit 0; NEW lines are expected)
- Worktree: a cloud session's own checkout; locally <repo root>/.claude/worktrees/web-screens (profile Notes)
- Profile verify (full, at the baseline and before the PR): `npm test` and `npm run build --workspace @smart-finances/infra`. No separate lint or typecheck exists; record "none".
- Every task may also touch, without stopping: apps/web/package.json and package-lock.json (for packages this brief allows), apps/web/src/i18n/en.ts and es.ts (new keys only, both files), and its own *.module.css files.
- Judgment: high tasks get a fresh-context reviewer before done: a subagent or fresh chat given the task, its diff and the review prompt in ~/.claude/skills/spec/references/handoff-prompts.md.
- Branch: feature/web-screens · Base: origin/feature/web-ui, after the previous PR is merged into it · Draft PR into feature/web-ui (D-121)
- Brief version: the locked-vN named in the handoff prompt; record it as pr-smart-finances-screens.md@locked-vN in progress-smart-finances-screens.json
- Order: PR 4 of 4.

## Read first
1. This file, all of it.
2. intent.md: Acceptance criteria, No-gos, Glossary.
3. architecture.md: Components "Data access (web server)", "Screens", "Screen states"; Contracts "Interfaces between the PRs", "Data API", "Accounts table", "Limits"; "States and exits" rows import, erasing, deleting account.
4. docs/specs/data-architecture/architecture.md: Contracts "HTTP routes" (the contract types.ts mirrors).
5. test-matrix.md rows whose task is SF-161 to SF-171.

## HUMAN needs
- <HUMAN: data PRs 2 and 3 merged into qa before the qa checks of imports, transactions, erase and delete account (D-64)> · Blocks: the qa checks, not the tasks

## Global constraints
- D-6: Roles: the agent writes code, commits, pushes feature branches and opens draft PRs into qa; the user reviews, merges and promotes. Source: data-architecture spec D-4 (default).
- D-18: Overview order, as one column read top to bottom: what you kept against your typical month; one line for what is waiting, only when something is; where it went, with the band strip as the header and the amounts under it; how you are doing over time; where you spent the most. No grid of equal panels. Net worth stays hidden until there is data for it.
- D-19: Wording: each overview section opens with its finding as a short headline sentence, not a neutral label.
- D-20: Typical month means the average of the previous six months. The user chose the average knowing one unusual month moves it: with the sample data, a month with a large one-off purchase pulls it from about 34% to about 20%.
- D-21: Light-mode ground: one colour field. The answer sits on a solid savings-green field, and in a bad month on an ink field, so red stays on the one bad figure (D-13). Below the field the page is white with no cards; sections are told apart by space and fine rules. The dark version is still to be designed.
- D-22: Type and spacing rules: sizes 12, 14, 16, 20, 24, 32, 48 plus one display size; body 16, tables and data 14, uppercase labels 12 with one letter-spacing. Weights 400, 500 and 700, with 800 only for the display figure. Spacing uses only the 4px-based tokens. Text meets 4.5:1 contrast and input borders 3:1. Click targets are at least 32px, and 44px on touch screens.
- D-23: Amounts: summaries (the overview's colour field, category rows and places) show pesos as whole numbers and dollars with cents. Lists of single transactions keep exact cents in both currencies.
- D-26: The kept bar in the overview's colour field labels its parts: what you spent and what you kept, each with its share, plus a marker for what a typical month keeps. In a bad month it labels where earnings ran out and how much you went over. Its texture is still open.
- D-30: Percentages in the colour field are whole numbers (32%, not 31.7%); the comparison sentence keeps its exact points.
- D-31: Earned in the colour field shows pesos first, at the month's dollar rate, with the dollars actually received as a second line ("USD 1,922.00 at ARS 1,375.00 per dollar"). A month with no rate shows dollars only and says it has no rate yet. Earned and Spent can now be compared in pesos, which removes the cost accepted in D-29.
- D-44: The top bar's menu button carries the amber "To review" count beside the screen name, so it shows from every screen. The user accepted one more mark in the bar than D-24 allowed.
- D-46: Assistant screens: designed now in the prototype and the design system; their code is built in Epic 4 against its real answer format.
- D-53: The web server sends the access token as a bearer token; the API's audience check takes the client id from it. A person confirms it on qa.
- D-57: Styling: the prototype's CSS custom properties as tokens with CSS modules; no Tailwind or shadcn. Charts in hand-drawn SVG, each with a table alternative.
- D-63: Red is also allowed for errors and failed statuses (error notes, failed or expired imports, a wrong password). Among money figures it stays only on the one bad figure. Narrows D-13.
- D-64: The web PR may merge into qa once it is green, before data PRs 2 and 3. Screens whose routes are missing show the failed state; their qa checks, and any promotion to staging, wait for those PRs.
- D-82: Data access on the server: server components read through one client that adds the token and counts requests; changes are Origin-checked route handlers; free-text search stays out of the address. Supersedes D-54.
- D-85: Typical month needs three earlier months with a dollar rate and averages up to six; before that, no comparison sentence (prototype copy). Narrows D-20.
- D-86: Skipped-row reasons: a translated lead, then the importer's own words as raw text in English. Narrows AC-4 for that text.
- D-101: No streaming on Amplify: a first load shows nothing until the server renders; each API read times out at 5 seconds; each overview section fails alone with its own retry; skeletons show only during in-app navigation.
- D-104: Delete account, final: first a full re-sign-in (password and code) and no running import; then mark deleting; that session alone may reach the finish route; erase, global sign-out, delete the pool user, remove rows. The hourly job finishes a stuck deletion by invoking the data service's delete function with the sub (one function, one grant; a follow-up row in the data-architecture spec) and alarms after 6 hours. Supersedes D-97.
- D-114: Import caps are reserved by one conditional update of the account row (under 10 today, no running import, stored bytes plus the source's maximum within 200 MiB) and released or corrected at the import's final status. Narrows D-96.
- D-120: No WAF for now, on any stage. Limits live in the web server's window counters: auth posts per IP 20 per 5 minutes, sign-in or reset failures per email and address prefix 5 per 15 minutes, code emails per email 3 an hour and 10 a day, data requests per person 120 a minute. A self-hosted proof-of-work check (served from the site, no third party) guards sign-up and the auth posts instead of the WAF challenge. The user accepts that floods reach the web server's compute. Supersedes D-90 and D-105.
- D-121: Integration branch: the four PRs (foundation, infra, auth, screens) each open as a draft into feature/web-ui, in order; once all are merged there, one PR from feature/web-ui into qa ships infra and web in one merge. The agent commits, pushes its feature branches and opens draft PRs; the user reviews, merges and promotes. Narrows D-6.
- Values:
  - Packages allowed: @aws-sdk/client-ssm, @aws-sdk/client-dynamodb, @aws-sdk/lib-dynamodb (same as PR 3).
  - Synthetic data: data/synthetic/transactions.csv; bad month 2026-03, no-rate month 2026-10.
  - Caps: 10 imports a day, 200 MiB stored, one running; source maximum 20 MiB for excel, 5 MiB for the others.
  - Web tests: `npm test --workspace @smart-finances/web -- <file>`; browser tests: `npm run e2e --workspace @smart-finances/web -- <file>`.
- Rules: README.md "Layout" (only data/synthetic is committed); .gitignore block "Real financial data stays local"; docs/adr/README.md (one ADR per decision, NNNN-short-title.md); docs/threat-model.md (update when a trust boundary or data store changes); public repo: no personal data or account ids in anything committed.

## ALWAYS / ASK FIRST / NEVER
**ALWAYS**
- Write the test first and see it fail. One task, one commit.
- Put the test id in the test title.
- Record each verify command and its result in progress-smart-finances-screens.json before the next task.
- Use synthetic data only (data/synthetic). No personal data, names, account ids or real figures in code, tests, fixtures, logs or commits.

**ASK FIRST**
- Adding or upgrading a dependency that no decision or this brief's Values names.
- Any command with side effects outside the worktree and the spec folder.

**NEVER**
- Merge, mark a PR ready, promote, push a protected branch, write to cloud resources, read production or enter a password.
- Edit a decision, intent.md, decisions.md or this brief. Record a deviation in progress-smart-finances-screens.json and stop.
- Log or store a password, code, token, secret, email or IP outside the places architecture.md Contracts allows.

## Tasks
### SF-160 · Record the baselines
- Implements: none · After: none · Judgment: normal
- Files: none (no change)
- Tests first: none
- Do:
  - Create the branch from the header off origin/feature/web-ui.
  - Run `npm ci`, then `npm test` and `npm run build --workspace @smart-finances/infra` (the profile's verify), plus the web workspace's tests once it exists.
  - Run drift as the header says.
- Verify: the profile's verify.smart-finances → each result recorded under baseline, red or green
- Done when: verify is green, evidence is in progress-smart-finances-screens.json
### SF-161 · Add the server data client, types and fixtures
- Implements: AC-6, AC-15, D-53, D-82, D-101 · After: SF-160 · Judgment: high
- Files: apps/web/src/server/api.ts (new), apps/web/src/server/types.ts (new), apps/web/src/server/fixtures.ts (new), apps/web/src/server/api.test.ts (new)
- Tests first: T-WSCR-1
- Do:
  - types.ts mirrors the data-architecture spec, Contracts "HTTP routes", route by route.
  - api.ts: bearer access token, 5-second timeout, errors keyed on status (401 refresh once then sign out; 403 and 404 not found; 409, 429, 5xx failed with retry), counts the person's requests.
  - fixtures.ts answers every route for STAGE=test from fixtures/sample.json (PR 1) plus the hostile rows of data/synthetic/generate.mjs; payments-report rows are source mercadopago.
- Verify: `npm test --workspace @smart-finances/web -- src/server/api.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-screens.json, and the reviewer has no blocker
### SF-162 · Work out kept, typical month and the bad month
- Implements: AC-2, AC-11, D-20, D-85, D-26 to D-31 · After: SF-161 · Judgment: normal
- Files: apps/web/src/screens/overview/model.ts (new), apps/web/src/screens/overview/model.test.ts (new)
- Tests first: T-WSCR-2, T-WSCR-3
- Do:
  - Signature: overviewModel(month, totals, rates) → { kept, typical?, bad?, … }. Inputs: GET /totals (view native and usd) and GET /rates. Kept in pesos at the month's rate, cents rounded half away from zero; typical month from 3 to 6 earlier rated months, none below 3; the bad month when spending exceeds earnings.
- Verify: `npm test --workspace @smart-finances/web -- src/screens/overview/model.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-screens.json
### SF-163 · Build the overview
- Implements: AC-2, AC-8, AC-11, D-18, D-19, D-21, D-26 to D-31, D-57, D-101 · After: SF-162 · Judgment: normal
- Files: apps/web/src/app/(app)/overview/ (new), apps/web/src/screens/overview/ (new), apps/web/e2e/overview.spec.ts (new)
- Tests first: T-WSCR-4, T-WSCR-5
- Do:
  - Colour field, kept bar, waiting line, band strip, sections with headline sentences, SVG charts with a table alternative; each section fails alone.
  - Money figures carry data-money; the bad figure also data-tone="bad". The browser test checks 2026-03: exactly one [data-money][data-tone=bad].
- Verify: `npm run e2e --workspace @smart-finances/web -- e2e/overview.spec.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-screens.json
### SF-164 · Build transactions
- Implements: AC-6, AC-9, D-82 · After: SF-161 · Judgment: normal
- Files: apps/web/src/app/(app)/transactions/ (new), apps/web/e2e/transactions.spec.ts (new)
- Tests first: T-WSCR-6
- Do:
  - Filters, sort and paging are requests (kinds from KINDS, categories from CATEGORIES, page size 50, default sort date descending); month, view, kind, category and sort in the address; free text in the form only.
- Verify: `npm run e2e --workspace @smart-finances/web -- e2e/transactions.spec.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-screens.json
### SF-165 · Build review and rates
- Implements: AC-8, D-44 · After: SF-161 · Judgment: normal
- Files: apps/web/src/app/(app)/review/ (new), apps/web/src/app/(app)/rates/ (new), apps/web/e2e/review-rates.spec.ts (new)
- Tests first: T-WSCR-7
- Do:
  - Category choice from CATEGORIES and approve for payments-report rows; fix-in-source note for others; rates with two decimals.
- Verify: `npm run e2e --workspace @smart-finances/web -- e2e/review-rates.spec.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-screens.json
### SF-166 · Build imports with caps, upload and status
- Implements: AC-5, AC-17, D-114, D-86 · After: SF-161 · Judgment: high
- Files: apps/web/src/app/(app)/imports/ (new), apps/web/src/server/caps.ts (new), apps/web/src/server/caps.test.ts (new), apps/web/e2e/imports.spec.ts (new)
- Tests first: T-WSCR-8, T-WSCR-9
- Do:
  - caps.ts wraps accounts.ts reserveImport and releaseImport: one conditional update on ACCT#<sub> reserves the slot (D-114; imports_today resets when the UTC day changes); the poll releases or corrects it at the final status; imports-paused read through SSM (cached 60 seconds). Source names and file-name rules are the data spec's POST /imports.
  - Upload with fetch and FormData to the presigned URL; poll the import through the server; skipped rows per D-86.
- Verify: `npm test --workspace @smart-finances/web -- src/server/caps.test.ts` and `npm run e2e --workspace @smart-finances/web -- e2e/imports.spec.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-screens.json, and the reviewer has no blocker
### SF-167 · Build your data: export and erase
- Implements: AC-7, AC-8 · After: SF-161 · Judgment: normal
- Files: apps/web/src/app/(app)/data/ (new), apps/web/e2e/erase.spec.ts (new)
- Tests first: T-WSCR-10
- Do:
  - Export download; "Erase my data" posts POST /api/data/erase with the typed word DELETE; the 35-day note and counts; timeout or 5xx says it may be unfinished and offers Finish erasing (the same route); reset stored_bytes on 202 in the accounts row.
- Verify: `npm run e2e --workspace @smart-finances/web -- e2e/erase.spec.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-screens.json
### SF-168 · Delete the account
- Implements: AC-18, D-104 · After: SF-167 · Judgment: high
- Files: apps/web/src/server/auth/deleteAccount.ts (new), apps/web/src/server/auth/deleteAccount.test.ts (new), apps/web/e2e/delete-account.spec.ts (new)
- Tests first: T-WSCR-11, T-WSCR-12
- Do:
  - POST /api/account/delete with { email, password, code }: signIn(email, password, { reauth: true }) plus the code, no running_import_id, and no running import, then mark deleting; POST /api/account/delete/finish (requireMoneyAccess({ allowDeleting: true })): erase until 202, signOutEverywhere, AdminDeleteUser (not found is done), remove the account row; signed-out page with counts.
  - Only the deleting session may reach the finish route; a test fails at each step and finishes it.
- Verify: `npm test --workspace @smart-finances/web -- src/server/auth/deleteAccount.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-screens.json, and the reviewer has no blocker
### SF-169 · Prove imported text stays inert
- Implements: AC-9 · After: SF-164, SF-166 · Judgment: normal
- Files: apps/web/e2e/hostile.spec.ts (new), scripts/check-no-raw-html.mjs (new), package.json
- Tests first: T-WSCR-13, T-WSCR-14
- Do:
  - Load the hostile synthetic rows on every screen that shows imported text; the payload shows as text, no img or script from it, no request or dialog.
  - The script fails on dangerouslySetInnerHTML, innerHTML or a markdown renderer in apps/web/src; root `npm test` runs it.
- Verify: `npm run e2e --workspace @smart-finances/web -- e2e/hostile.spec.ts` and `node scripts/check-no-raw-html.mjs` → pass
- Done when: verify is green, evidence is in progress-smart-finances-screens.json
### SF-170 · Keyboard, contrast and language checks
- Implements: AC-4, AC-10, D-22 · After: SF-163 to SF-169, SF-171 · Judgment: normal
- Files: apps/web/e2e/a11y.spec.ts (new)
- Tests first: T-WSCR-15, T-WSCR-16
- Do:
  - axe on every screen in both languages and both colour schemes (Playwright emulateMedia); keyboard walk of every action with visible focus; switching language keeps the screen and address.
- Verify: `npm run e2e --workspace @smart-finances/web -- e2e/a11y.spec.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-screens.json
### SF-171 · Show the per-person limit page
- Implements: AC-17, D-120 · After: SF-161 · Judgment: normal
- Files: apps/web/src/app/(app)/too-many/ (new), apps/web/e2e/limit.spec.ts (new)
- Tests first: T-WSCR-17
- Do:
  - Past the person limit (5 a minute under STAGE=test) the next page is the plain 429 page with the wait; a second signed-in test person is still served.
- Verify: `npm run e2e --workspace @smart-finances/web -- e2e/limit.spec.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-screens.json

## Stop and hand back when
- A task would deviate from a decision. Record the deviation first.
- A value this brief needs is missing.
- Verify is still red after 2 fix rounds.
- A change is needed outside the task's Files.
- Credentials or production access are needed.
- The next step is a push to a protected branch, marking a PR ready, or a merge.
- The draft PR is open and its body is checked.

## Hand-back report
- PR: link and state
- Tool and model: as recorded in progress
- Baseline → final: tests, lint, typecheck
- Tasks: done and blocked, with commit shas
- Deviations: each with the decision it touches and the proposal
- Surprises: what this brief did not predict, with evidence
- Next HUMAN step

## PR body
No PR template exists (profile Notes). Include: what changed per task id, test ids and results, deviations, and the HUMAN steps left. The PR targets feature/web-ui (D-121), never qa.
