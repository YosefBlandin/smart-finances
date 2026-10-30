---
spec: web-ui
ticket: none
tier: L
status: locked-v2
---
# Web UI: design system and screens: brief for smart-finances (PR 4 of 4, screens)

<!-- The executor's main document. It must stand alone: copy values in, and link only to sections a task cites. At most 6k tokens; comments do not count. Required reading (intent.md, this file and its Read first sections) stays under 15k. Before the lock, the cold-read dry run must find zero "cannot start" items. -->

- Goal: a signed-in person uses fast, interactive overview, transactions, review, imports, rates and data screens, and can erase their data or delete their account.
- Implements: AC-2, AC-4 to AC-11, AC-15, AC-17, AC-18, D-18 to D-21, D-26 to D-31, D-82, D-85, D-86, D-101, D-104, D-114, D-127, D-130, D-131, D-135
- Spec folder: /home/user/smart-finances/docs/specs/web-ui in a cloud session; locally <repo root>/docs/specs/web-ui. Read and write the spec there, on the branch named under Branch, never a copy elsewhere.
- Refs: smart-finances at the sha in intent.md refs. Before the first task: `git fetch origin qa feature/web-ui`, then `node ~/.claude/skills/spec/scripts/drift.mjs docs/specs/web-ui --strict` (exit 0; NEW lines are expected)
- Worktree: a cloud session's own checkout; locally <repo root>/.claude/worktrees/web-screens (profile Notes)
- Profile verify (full, at the baseline and before the PR): `npm test` and `npm run build --workspace @smart-finances/infra`. Before PR 1's SF-104 no lint exists; record "none". From then on also `npm run lint --workspace @smart-finances/web`.
- Every task may also touch, without stopping: apps/web/package.json and package-lock.json (for packages this brief allows), apps/web/messages/en.json and es.json (new keys only, both files), apps/web/src/adapters/container.ts and adapters/memory/ (to register what the task adds), and its own *.module.css files.
- Judgment: high tasks get a fresh-context reviewer before done: a subagent or fresh chat given the task, its diff and the review prompt in ~/.claude/skills/spec/references/handoff-prompts.md.
- Branch: feature/web-screens · Base: origin/feature/web-ui, after the previous PR is merged into it · Draft PR into feature/web-ui (D-121)
- Brief version: the locked-vN named in the handoff prompt; record it as pr-smart-finances-screens.md@locked-vN in progress-smart-finances-screens.json
- Order: PR 4 of 4.

## Read first
1. This file, all of it.
2. intent.md: Acceptance criteria, No-gos, Glossary.
3. architecture.md: Components "Code structure", "Component architecture", "Data access (web server)", "Screens", "Screen states"; Contracts "Ports", "Interfaces between the PRs", "Data API", "Accounts table", "Limits"; "States and exits" rows import, erasing, deleting account.
4. docs/specs/data-architecture/architecture.md: Contracts "HTTP routes".
5. test-matrix.md rows whose task is SF-161 to SF-172.

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
- D-127: Interactive data: a client query library runs in the browser against same-origin JSON routes /api/data/* that add the person's token on the server, so the browser never holds a token. The server prefetches and hydrates the first view; filters, sort and paging then update without a page load and keep the address in sync; mutations call the server actions with optimistic updates rolled back on error. Narrows D-82.
- D-128: Loading: skeletons for content that is loading, and a spinner only inside the button whose action runs; nothing else spins. Narrows D-101.
- D-130: The client query library is TanStack Query (@tanstack/react-query): server prefetch and hydration, infinite queries for cursor paging, mutations with optimistic updates and rollback, devtools in development only. Completes D-127.
- D-131: Optimistic updates only for review choices and approvals, and dollar rates; erase, delete account, imports and the language switch wait for the server's answer.
- D-135: Browser monitoring with CloudWatch RUM: page loads, web vitals and JavaScript errors, client bundled from npm, no cookies, addresses stripped of search values, no person ids; a guest identity pool may only put RUM events; about 1 dollar per 100,000 events.
- D-138: Code architecture: the web server's logic is hexagonal (domain, application use cases, ports, adapters, with in-memory adapters for tests and Storybook); Next.js app/ only delivers (pages, layouts, server actions, JSON routes) and calls use cases through one container; presentation (ui, screens, queries, i18n) follows Next.js conventions. ESLint import rules enforce the dependency direction.
- Values:
  - Each screen section: View.tsx (props only) and Container.tsx (hooks, actions), built from ui/patterns and ui/primitives.
  - Packages allowed: aws-rum-web, plus those of PRs 1 and 3.
  - Copy and visuals: the prototype https://claude.ai/code/artifact/10e1188c-9601-4133-9a2d-3502b0bc2ac6 and apps/web/design/prototype-screens.md (keys).
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
### SF-161 · Data API port and adapter, with the memory adapter on fixtures
- Implements: AC-6, AC-15, D-53, D-101, D-133 · After: SF-160 · Judgment: high
- Files: apps/web/src/ports/DataApi.ts, apps/web/src/adapters/data-api.ts (new), apps/web/src/adapters/memory/data-api.ts, apps/web/src/adapters/data-api.test.ts (new)
- Tests first: T-WSCR-1
- Do:
  - One method per route; bearer access token; 5-second timeout; replies parsed with @smart-finances/contracts; 401 refresh once then sign out, 403 and 404 not found, 409, 429 and 5xx failed with retry; counts the person’s requests.
  - Memory adapter: apps/web/fixtures/sample.json plus the adversarial rows of data/synthetic/transactions.csv copied into apps/web/fixtures/hostile.json; payments-report rows are source mercadopago. A limited result redirects server renders to /too-many and makes JSON routes answer 429.
- Verify: `npm test --workspace @smart-finances/web -- src/adapters/data-api.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-screens.json, and the reviewer has no blocker
### SF-162 · Overview domain: kept, typical month, bad month
- Implements: AC-2, AC-11, D-20, D-85, D-26 to D-31 · After: SF-161 · Judgment: normal
- Files: apps/web/src/domain/money.ts (new), apps/web/src/domain/money.test.ts (new)
- Tests first: T-WSCR-2, T-WSCR-3
- Do:
  - overviewModel(month, totals, rates) → { earnedArs, spentArs, keptArs, keptPct, typicalPct?, typicalMonths, bad, overArs?, noRate }: dollars convert at the month’s rate (cents half away from zero); typicalPct is the average keptPct of 3 to 6 earlier rated months, absent below 3; months without a rate are skipped; bad when spending exceeds earnings.
- Verify: `npm test --workspace @smart-finances/web -- src/domain/money.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-screens.json
### SF-163 · JSON read routes and query hooks
- Implements: AC-6, D-127, D-130 · After: SF-161 · Judgment: high
- Files: apps/web/src/application/data/ (new: read use cases), apps/web/src/app/api/data/ (new: transactions, totals, rates, review, imports, imports/[id], export), apps/web/src/queries/ (new hooks), apps/web/src/app/api/data/data.test.ts (new)
- Tests first: T-WSCR-18
- Do:
  - Each route calls requireMoneyAccess and a read use case and returns parsed JSON; export streams the CSV.
  - Hooks: useTransactions (infinite, cursor), useTotals, useRates, useReview, useImports, useImport (polls until final); query keys include month, view and filters.
- Verify: `npm test --workspace @smart-finances/web -- src/app/api/data/data.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-screens.json, and the reviewer has no blocker
### SF-164 · Overview: server prefetch and island
- Implements: AC-2, AC-8, AC-11, D-18, D-19, D-21, D-26 to D-31, D-57, D-101, D-128 · After: SF-162, SF-163 · Judgment: normal
- Files: apps/web/src/app/(app)/overview/ (page prefetches and hydrates), apps/web/src/screens/overview/ (new), apps/web/e2e/overview.spec.ts (new)
- Tests first: T-WSCR-4, T-WSCR-5
- Do:
  - Colour field, kept bar, waiting line, band strip, headline sections, SVG charts with table alternatives; each section shows its own skeleton or failed note.
  - Money figures carry data-money and the bad one data-tone="bad"; in 2026-03 exactly one [data-money][data-tone=bad].
- Verify: `npm run e2e --workspace @smart-finances/web -- e2e/overview.spec.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-screens.json
### SF-165 · Transactions island
- Implements: AC-6, AC-9, D-82 · After: SF-163 · Judgment: normal
- Files: apps/web/src/app/(app)/transactions/, apps/web/src/screens/transactions/ (new), apps/web/e2e/transactions.spec.ts (new)
- Tests first: T-WSCR-6
- Do:
  - Instant filters, sort and paging through useTransactions (kinds from KINDS, categories from CATEGORIES, page size 50, date descending); month, view, kind, category and sort in the address via router.replace; free text in the form only.
- Verify: `npm run e2e --workspace @smart-finances/web -- e2e/transactions.spec.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-screens.json
### SF-166 · Review and rates with optimistic updates
- Implements: AC-8, D-44, D-131 · After: SF-163 · Judgment: high
- Files: apps/web/src/application/data/{review,setRate}.ts (new), apps/web/src/app/(app)/review/, apps/web/src/app/(app)/rates/, apps/web/src/screens/{review,rates}/ (new), apps/web/e2e/review-rates.spec.ts (new)
- Tests first: T-WSCR-7, T-WSCR-19
- Do:
  - Server actions through guarded(); useMutation with onMutate snapshot and optimistic change, onError rollback with a plain message, onSettled invalidation of review, totals and the to-review count.
  - Other sources show the fix-in-source note; rates keep two decimals.
- Verify: `npm run e2e --workspace @smart-finances/web -- e2e/review-rates.spec.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-screens.json, and the reviewer has no blocker
### SF-167 · Imports with caps, upload and status
- Implements: AC-5, AC-17, D-114, D-86 · After: SF-163 · Judgment: high
- Files: apps/web/src/application/data/requestImport.ts (new), apps/web/src/app/(app)/imports/, apps/web/src/screens/imports/ (new), apps/web/src/application/data/requestImport.test.ts (new), apps/web/e2e/imports.spec.ts (new)
- Tests first: T-WSCR-8, T-WSCR-9
- Do:
  - requestImport checks the name and size with SOURCES from @smart-finances/contracts, reserves a slot with AccountStore.reserveImport (D-114; the day is UTC) and checks imports-paused ("true" pauses) through ParameterStore (adapters/ssm.ts, new); the getImport use case behind /api/data/imports/[id] releases or corrects it at the final status.
  - Upload with fetch and FormData to the presigned URL; skipped rows per D-86; source names and file-name rules from the data spec’s POST /imports.
- Verify: `npm test --workspace @smart-finances/web -- src/application/data/requestImport.test.ts` and `npm run e2e --workspace @smart-finances/web -- e2e/imports.spec.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-screens.json, and the reviewer has no blocker
### SF-168 · Your data: export and erase
- Implements: AC-7, AC-8 · After: SF-163 · Judgment: normal
- Files: apps/web/src/application/data/erase.ts (new), apps/web/src/app/(app)/data/, apps/web/src/screens/data/ (new), apps/web/e2e/erase.spec.ts (new)
- Tests first: T-WSCR-10
- Do:
  - Export link to /api/data/export; "Erase my data" is a server action with the typed word DELETE, the 35-day note and counts; timeout or 5xx says it may be unfinished and offers Finish erasing (the same action); resetStoredBytes on 202. No optimistic update.
- Verify: `npm run e2e --workspace @smart-finances/web -- e2e/erase.spec.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-screens.json
### SF-169 · Delete the account
- Implements: AC-18, D-104 · After: SF-168 · Judgment: high
- Files: apps/web/src/application/account/deleteAccount.ts (new), apps/web/src/domain/deletion.ts (new), apps/web/src/app/(app)/data/delete/ (new), apps/web/src/app/goodbye/ (new), apps/web/src/application/account/deleteAccount.test.ts (new), apps/web/e2e/delete-account.spec.ts (new)
- Tests first: T-WSCR-11, T-WSCR-12
- Do:
  - Action 1 with { email, password, code }: signIn reauth plus the code, no running_import_id, then markDeleting. Action 2 (allowDeleting): erase until 202, signOutEverywhere, adminDelete (not found is done), deleteAccountRow; set a 5-minute signed HttpOnly goodbye cookie with the counts and go to /goodbye, a public route that reads it.
  - domain/deletion.ts holds the step order; a test fails each step and finishes it.
- Verify: `npm test --workspace @smart-finances/web -- src/application/account/deleteAccount.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-screens.json, and the reviewer has no blocker
### SF-170 · Prove imported text stays inert
- Implements: AC-9 · After: SF-164 to SF-167 · Judgment: normal
- Files: apps/web/e2e/hostile.spec.ts (new), scripts/check-no-raw-html.mjs (new), package.json
- Tests first: T-WSCR-13, T-WSCR-14
- Do:
  - Hostile rows on transactions, review and imports show as text; no element, request or dialog from them. The script fails on dangerouslySetInnerHTML, innerHTML or a markdown renderer in apps/web/src; root `npm test` runs it.
- Verify: `npm run e2e --workspace @smart-finances/web -- e2e/hostile.spec.ts` and `node scripts/check-no-raw-html.mjs` → pass
- Done when: verify is green, evidence is in progress-smart-finances-screens.json
### SF-171 · Screen-state stories, accessibility and keyboard checks
- Implements: AC-4, AC-8, AC-10, D-22, D-129 · After: SF-164 to SF-169 · Judgment: normal
- Files: apps/web/src/screens/**/*.stories.tsx (new), apps/web/e2e/a11y.spec.ts (new)
- Tests first: T-WSCR-15, T-WSCR-16
- Do:
  - A story per screen state in architecture.md "Screen states", on the memory adapters, both languages and colour schemes.
  - axe on every screen; a keyboard walk of every action with visible focus; a language switch keeps the screen and address.
- Verify: `npm run e2e --workspace @smart-finances/web -- e2e/a11y.spec.ts` and `npm run test-storybook --workspace @smart-finances/web` → pass
- Done when: verify is green, evidence is in progress-smart-finances-screens.json
### SF-172 · Limit page and browser monitoring
- Implements: AC-17, D-120, D-135 · After: SF-163 · Judgment: normal
- Files: apps/web/src/app/(app)/too-many/ (new), apps/web/src/app/rum.tsx (new client component, mounted in app/layout.tsx), apps/web/e2e/limit.spec.ts (new), apps/web/src/app/rum.test.ts (new)
- Tests first: T-WSCR-17, T-WSCR-20
- Do:
  - Past the person limit (5 a minute under STAGE=test) the 429 page shows with the wait; a second signed-in test person is still served.
  - aws-rum-web initialised from the rum-* settings: no cookies, page ids without search values, no person id; disabled under STAGE=test.
- Verify: `npm run e2e --workspace @smart-finances/web -- e2e/limit.spec.ts` and `npm test --workspace @smart-finances/web -- src/app/rum.test.ts` → pass
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
