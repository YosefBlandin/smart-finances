---
spec: web-ui
ticket: none
tier: L
status: draft
---
# Web UI: design system and screens: brief for smart-finances (PR 1 of 4, foundation)

<!-- The executor's main document. It must stand alone: copy values in, and link only to sections a task cites. At most 6k tokens; comments do not count. Required reading (intent.md, this file and its Read first sections) stays under 15k. Before the lock, the cold-read dry run must find zero "cannot start" items. -->

- Goal: the prototype has every auth and account screen, the contracts package exists, and apps/web is a linted Next.js app with tokens, words, headers, parts, Storybook, the query provider, the hexagonal skeleton and the shell.
- Implements: AC-4, AC-8, AC-9, AC-10, AC-11, AC-16, D-57, D-58, D-62, D-71, D-100, D-108, D-124, D-126, D-127, D-129, D-130, D-132 to D-134, D-136 to D-138
- Spec folder: /home/user/smart-finances/docs/specs/web-ui in a cloud session; locally <repo root>/docs/specs/web-ui. Read and write the spec there, on the branch named under Branch, never a copy elsewhere.
- Refs: smart-finances at the sha in intent.md refs. Before the first task: `git fetch origin qa feature/web-ui`, then `node ~/.claude/skills/spec/scripts/drift.mjs docs/specs/web-ui --strict` (exit 0; NEW lines are expected)
- Worktree: a cloud session's own checkout; locally <repo root>/.claude/worktrees/web-foundation (profile Notes)
- Profile verify (full, at the baseline and before the PR): `npm test` and `npm run build --workspace @smart-finances/infra`. Before PR 1's SF-104 no lint exists; record "none". From then on also `npm run lint --workspace @smart-finances/web`.
- Every task may also touch, without stopping: apps/web/package.json and package-lock.json (for packages this brief allows), apps/web/messages/en.json and es.json (new keys only, both files), apps/web/src/adapters/container.ts and adapters/memory/ (to register what the task adds), and its own *.module.css files.
- Judgment: high tasks get a fresh-context reviewer before done: a subagent or fresh chat given the task, its diff and the review prompt in ~/.claude/skills/spec/references/handoff-prompts.md.
- Branch: feature/web-foundation · Base: origin/feature/web-ui · Draft PR into feature/web-ui (D-121)
- Brief version: the locked-vN named in the handoff prompt; record it as pr-smart-finances.md@locked-vN in progress-smart-finances.json
- Order: PR 1 of 4.

## Read first
1. This file, all of it.
2. intent.md: Acceptance criteria, No-gos, Glossary.
3. architecture.md: Components "Web app (Next.js)", "Code structure", "Design tokens and parts", "Words and formats", "Shared contracts package"; Contracts "Interfaces between the PRs", "Web routes", "Cookies", "Response headers", "Web server settings".
4. docs/specs/data-architecture/architecture.md: Contracts "HTTP routes" (for SF-102).
5. test-matrix.md rows whose task is SF-101 to SF-114.

## HUMAN needs
- <HUMAN: review the extended prototype and say go before SF-111> · Blocks: SF-111
- <HUMAN: merge the spec PR into feature/web-ui so the spec and this brief are on the base> · Blocks: SF-100

## Global constraints
- D-17: Icons: Tabler outline icons at a 2px line, which matches the stem of Chivo 400. They mark the current screen, statuses, review reasons, notes and assistant answers, always next to a word. Narrows D-15: bands now appear only where they carry a number (the spending strip, bars and the category key) plus the logo.
- D-19: Wording: each overview section opens with its finding as a short headline sentence, not a neutral label.
- D-22: Type and spacing rules: sizes 12, 14, 16, 20, 24, 32, 48 plus one display size; body 16, tables and data 14, uppercase labels 12 with one letter-spacing. Weights 400, 500 and 700, with 800 only for the display figure. Spacing uses only the 4px-based tokens. Text meets 4.5:1 contrast and input borders 3:1. Click targets are at least 32px, and 44px on touch screens.
- D-23: Amounts: summaries (the overview's colour field, category rows and places) show pesos as whole numbers and dollars with cents. Lists of single transactions keep exact cents in both currencies.
- D-30: Percentages in the colour field are whole numbers (32%, not 31.7%); the comparison sentence keeps its exact points.
- D-34: Lists mark a category with the same solid square as the overview's category rows, not a striped mark, so one category has one mark everywhere and its colour shows at list size.
- D-35: Desktop rail: the rail stays in view while the page scrolls, with the account area pinned to its bottom, so the nav and Sign out are always on screen.
- D-37: Language leaves the nav and joins the account area as one row that names the other language ("Español" in English, "English" in Spanish), beside the language icon and shaped like the Sign out row. The two-way switch goes.
- D-38: The account area says who is signed in (the address, then "Authenticator on" in small muted text), then the language row and Sign out as a plain row with no border, so nothing in the rail is boxed.
- D-39: The current screen is marked by a 2px ink line beside its bold ink label, with no fill and no shadow (16.1:1 light, 13.9:1 dark against the rail). Hover keeps the white fill.
- D-40: The wordmark is set at 700, not 800, so 800 stays for the display figure (D-22). The environment tag ("qa") is a 12px uppercase label in Chivo, not Chivo Mono (D-16).
- D-41: Nav group labels sit 24px below the group above and 8px above their first link, so each label heads its own group.
- D-42: The Spanish nav label for dollar rates is "Cotizaciones", which fits on one line; the screen title keeps "Cotización del dólar".
- D-43: The top bar from D-24 applies up to 960px, not 720px, so tablets get it too. Its menu opens as a panel over the page, under the bar, without moving the page; the button shows a close mark while open and is 44px tall. Narrows D-24.
- D-44: The top bar's menu button carries the amber "To review" count beside the screen name, so it shows from every screen. The user accepted one more mark in the bar than D-24 allowed.
- D-46: Assistant screens: designed now in the prototype and the design system; their code is built in Epic 4 against its real answer format.
- D-57: Styling: the prototype's CSS custom properties as tokens with CSS modules; no Tailwind or shadcn. Charts in hand-drawn SVG, each with a table alternative.
- D-58: Fonts (Chivo, Chivo Mono) and Tabler icons are bundled; no font or icon service at run time.
- D-63: Red is also allowed for errors and failed statuses (error notes, failed or expired imports, a wrong password). Among money figures it stays only on the one bad figure. Narrows D-13.
- D-86: Skipped-row reasons: a translated lead, then the importer's own words as raw text in English. Narrows AC-4 for that text.
- D-100: The prototype gains every auth and account screen (sign-up, confirm, setup, sign-in, code, reset, lost authenticator, delete account, too many tries, not found) in both languages, and fixes its sign-in copy, before any screen is coded.
- D-108: Middleware does only the nonce, the content policy and a cookie-presence redirect; the session, consent and deleting checks run in a server-only helper called by the money layout and every route handler.
- D-121: Integration branch: the four PRs (foundation, infra, auth, screens) each open as a draft into feature/web-ui, in order; once all are merged there, one PR from feature/web-ui into qa ships infra and web in one merge. The agent commits, pushes its feature branches and opens draft PRs; the user reviews, merges and promotes. Narrows D-6.
- D-128: Loading: skeletons for content that is loading, and a spinner only inside the button whose action runs; nothing else spins. Narrows D-101.
- Values:
  - Prototype: https://claude.ai/code/artifact/10e1188c-9601-4133-9a2d-3502b0bc2ac6 (synthetic data only).
  - Packages allowed: next 15, react 19, typescript, zod, next-intl, @tanstack/react-query (+ devtools), vitest, jsdom, @testing-library/react, @playwright/test, @axe-core/playwright, storybook (@storybook/nextjs, -addon-a11y, -test-runner), eslint (eslint-config-next, -plugin-jsx-a11y, -plugin-import), prettier, @lhci/cli, @tabler/icons-react, @fontsource/chivo, @fontsource/chivo-mono.
  - Web tests: `npm test --workspace @smart-finances/web -- <file>`; browser tests: `npm run e2e --workspace @smart-finances/web -- <file>`.
  - Breakpoints: top bar under 960px; touch targets 44px; click targets 32px.
- Rules: README.md "Layout" (only data/synthetic is committed); .gitignore block "Real financial data stays local"; docs/adr/README.md (one ADR per decision, NNNN-short-title.md); docs/threat-model.md (update when a trust boundary or data store changes); public repo: no personal data or account ids in anything committed.

## ALWAYS / ASK FIRST / NEVER
**ALWAYS**
- Write the test first and see it fail. One task, one commit.
- Put the test id in the test title.
- Record each verify command and its result in progress-smart-finances.json before the next task.
- Use synthetic data only (data/synthetic). No personal data, names, account ids or real figures in code, tests, fixtures, logs or commits.

**ASK FIRST**
- Adding or upgrading a dependency that no decision or this brief's Values names.
- Any command with side effects outside the worktree and the spec folder.

**NEVER**
- Merge, mark a PR ready, promote, push a protected branch, write to cloud resources, read production or enter a password.
- Edit a decision, intent.md, decisions.md or this brief. Record a deviation in progress-smart-finances.json and stop.
- Log or store a password, code, token, secret, email or IP outside the places architecture.md Contracts allows.

## Tasks
### SF-100 · Record the baselines
- Implements: none · After: none · Judgment: normal
- Files: none (no change)
- Tests first: none
- Do:
  - Create the branch from the header off origin/feature/web-ui.
  - Run `npm ci`, then `npm test` and `npm run build --workspace @smart-finances/infra` (the profile's verify), plus the web workspace's tests once it exists.
  - Run drift as the header says.
- Verify: the profile's verify.smart-finances → each result recorded under baseline, red or green
- Done when: verify is green, evidence is in progress-smart-finances.json
### SF-101 · Add every auth and account screen to the prototype, and export its sample data
- Implements: AC-12, AC-13, AC-14, AC-18, AC-19, AC-20, D-100 · After: SF-100 · Judgment: normal
- Files: the prototype artifact (read and republish with the Artifact tool; link in Values), apps/web/design/prototype-screens.md (new), apps/web/fixtures/sample.json (new)
- Tests first: T-WEB-1
- Do:
  - Use the account skill smart-finances-ui (anthropic-skills:smart-finances-ui) and its checks: calm-ui css_audit.py and contrast.py, prototype-check syntax_check.py, class_check.py and shoot.py; without the skill, the prototype file and decisions.md are the sources.
  - Add, in English and Spanish: sign-up with terms and privacy acceptance and the proof-of-work note; confirm (resend, expired); setup with QR and key text; code; reset and reset confirm; lost authenticator; consent; delete account (re-sign-in, warning, partial failure, signed-out result with counts); too many tries; not found; signed out after idle.
  - Copy fixes: "Sign out when you’re done; the session also ends after 30 idle minutes"; no temporary-password screen.
  - Republish; list every new screen and state in prototype-screens.md with proposed message keys (screen.part).
  - Export the prototype’s synthetic sample (months, rates, imports in every state, review rows, mercadopago rows) to apps/web/fixtures/sample.json; 2026-03 stays a bad month and 2026-10 has no rate.
- Verify: the skill’s scripts on the saved prototype → syntax, class and smoke checks pass; screenshots in both languages and themes saved under apps/web/design/shots/ (git-ignored)
- Done when: verify is green, evidence is in progress-smart-finances.json
### SF-102 · Create the shared contracts package
- Implements: AC-6, D-133, D-124 · After: SF-100 · Judgment: normal
- Files: packages/contracts/ (new: package.json @smart-finances/contracts, src/fields.mjs, src/categories.mjs, src/routes.mjs, test/contracts.test.mjs), smart-finances:apps/api/src/ingest/schema.mjs#FIELDS, smart-finances:apps/api/src/ingest/categories.mjs#categoryFor, smart-finances:package.json
- Tests first: T-WEB-2
- Do:
  - Root workspaces gain "packages/*". FIELDS, KINDS and CATEGORIES (rule categories in rule order, then Uncategorized) live in the package; schema.mjs and categories.mjs import them and keep their exports.
  - routes.mjs: one Zod schema per request and reply in docs/specs/data-architecture/architecture.md, Contracts "HTTP routes", plus the error shape { error: { code, message } }.
- Verify: `node --test packages/contracts/test/contracts.test.mjs` and the root `npm test` → all pass
- Done when: verify is green, evidence is in progress-smart-finances.json
### SF-103 · Scaffold the Next.js app with a health route
- Implements: D-71, D-110, D-59 · After: SF-100 · Judgment: normal
- Files: smart-finances:apps/web/package.json, apps/web/next.config.ts (new), apps/web/tsconfig.json (new), apps/web/vitest.config.ts (new), apps/web/playwright.config.ts (new), apps/web/src/app/layout.tsx (new), apps/web/src/app/api/health/route.ts (new), apps/web/src/app/api/health/route.test.ts (new), apps/web/amplify.yml (new), package.json
- Tests first: T-WEB-3
- Do:
  - Next.js 15 App Router, React 19, TypeScript strict; scripts dev (port 3000, strictPort), build, start, test (vitest run), e2e (playwright test, webServer `next dev` with STAGE=test), lint (added in SF-104), storybook.
  - /api/health returns { sha: process.env.COMMIT_SHA, stage: process.env.STAGE } with no-store; until PR 3, code reads process.env with test defaults when STAGE=test.
  - amplify.yml (monorepo, appRoot apps/web): npm ci at the root, lint and web unit tests, write the settings in Contracts "Web server settings" plus COMMIT_SHA from AWS_COMMIT_ID into apps/web/.env.production, next build; artifacts .next.
  - Root `npm test` also runs the web unit tests.
- Verify: `npm test --workspace @smart-finances/web -- src/app/api/health/route.test.ts` → pass; `npm run build --workspace @smart-finances/web` → succeeds
- Done when: verify is green, evidence is in progress-smart-finances.json
### SF-104 · Add ESLint, Prettier and the boundary rules
- Implements: D-132, D-138 · After: SF-103 · Judgment: normal
- Files: apps/web/eslint.config.mjs (new), apps/web/.prettierrc (new), apps/web/src/boundaries.test.ts (new)
- Tests first: T-WEB-13
- Do:
  - eslint-config-next, react-hooks, jsx-a11y, and import/no-restricted-paths for the D-138 direction: domain imports only domain and contracts; application only domain and ports; ui, screens and queries never adapters or application.
  - Scripts lint (eslint + prettier --check); root `npm test` runs it. The test lints fixture files that break each rule and expects errors.
- Verify: `npm test --workspace @smart-finances/web -- src/boundaries.test.ts` and `npm run lint --workspace @smart-finances/web` → pass
- Done when: verify is green, evidence is in progress-smart-finances.json
### SF-105 · Copy the design tokens, fonts and icons
- Implements: AC-10, D-57, D-58, D-17, D-22, D-25 · After: SF-103 · Judgment: normal
- Files: apps/web/src/styles/tokens.css (new), apps/web/src/styles/base.css (new), apps/web/src/app/fonts.ts (new), apps/web/src/styles/tokens.test.ts (new)
- Tests first: T-WEB-4
- Do:
  - Every custom property from the prototype (light, the dark media query, data-theme dark) copied unchanged.
  - Chivo and Chivo Mono through next/font/local from the @fontsource packages’ woff2 files.
  - The test checks --t-xs to --t-display, --w-text to --w-display and --s1 to --s7 exist, and that no --cat1 to --cat12 equals --bad.
- Verify: `npm test --workspace @smart-finances/web -- src/styles/tokens.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances.json
### SF-106 · Set up next-intl and the formatters
- Implements: AC-4, D-11, D-19, D-23, D-30, D-83, D-86, D-126 · After: SF-103 · Judgment: normal
- Files: apps/web/messages/en.json (new), apps/web/messages/es.json (new), apps/web/src/i18n/request.ts (new), apps/web/src/i18n/format.ts (new), apps/web/src/i18n/i18n.test.ts (new)
- Tests first: T-WEB-5, T-WEB-6
- Do:
  - next-intl without locale routing: request.ts picks the lang cookie, else Accept-Language (es* → es, else en).
  - Messages start from the prototype’s word list with ICU zero, one and other forms; the same keys in both files.
  - format.ts: pesos whole in summaries, dollars with cents, exact cents in transaction lists, whole percentages (D-23, D-30).
- Verify: `npm test --workspace @smart-finances/web -- src/i18n/i18n.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances.json
### SF-107 · Set the nonce content policy and security headers in middleware
- Implements: AC-16, AC-9, D-108, D-115 · After: SF-103 · Judgment: high
- Files: apps/web/src/middleware.ts (new), apps/web/src/middleware.test.ts (new), apps/web/e2e/headers.spec.ts (new)
- Tests first: T-WEB-7, T-WEB-8
- Do:
  - Per request a fresh nonce (also in the x-nonce request header); headers exactly as architecture.md Contracts "Response headers".
  - Redirect by cookie presence only: no __Host-sid on a money route → /sign-in?next=<path>; __Host-sid on an auth route → /overview. No AWS SDK in middleware.
  - The browser test checks the policy and that an inline script without the nonce does not run.
- Verify: `npm test --workspace @smart-finances/web -- src/middleware.test.ts` and `npm run e2e --workspace @smart-finances/web -- e2e/headers.spec.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances.json, and the reviewer has no blocker
### SF-108 · Lay out the hexagonal skeleton
- Implements: D-138, D-124 · After: SF-104 · Judgment: normal
- Files: apps/web/src/domain/ (new), apps/web/src/application/ (new), apps/web/src/ports/ (new: one interface file per port in architecture.md "Code structure"), apps/web/src/adapters/memory/ (new), apps/web/src/adapters/container.ts (new), apps/web/src/adapters/container.test.ts (new)
- Tests first: T-WEB-14
- Do:
  - Port interfaces only (signatures from architecture.md Contracts "Interfaces between the PRs"); memory adapters implement each with Maps, conditional updates and a controllable Clock.
  - container.ts returns the memory adapters when STAGE=test; real adapters are added by later PRs.
- Verify: `npm test --workspace @smart-finances/web -- src/adapters/container.test.ts` and the lint → pass
- Done when: verify is green, evidence is in progress-smart-finances.json
### SF-109 · Build the base parts and set up Storybook
- Implements: AC-8, AC-10, AC-11, D-63, D-22, D-34, D-128, D-129, D-136 · After: SF-105, SF-106 · Judgment: normal
- Files: apps/web/src/ui/ (new): Button, Field, Chip, Note, StateBlock, Skeleton, Table, CategorySquare with *.module.css, *.stories.tsx and ui.test.tsx; apps/web/.storybook/ (new)
- Tests first: T-WEB-9, T-WEB-15
- Do:
  - Parts use tokens only; Button shows a spinner only while busy; Field ties its error with aria-describedby; form messages role=alert; red only for errors and failed statuses (D-63).
  - Storybook (Next.js framework) with the a11y add-on and the test runner; a story per part in both languages and both colour schemes; script test-storybook.
- Verify: `npm test --workspace @smart-finances/web -- src/ui/ui.test.tsx` and `npm run test-storybook --workspace @smart-finances/web` → pass
- Done when: verify is green, evidence is in progress-smart-finances.json
### SF-110 · Add the TanStack Query provider and hydration helper
- Implements: D-127, D-130, D-137 · After: SF-103 · Judgment: normal
- Files: apps/web/src/queries/provider.tsx (new), apps/web/src/queries/prefetch.ts (new), apps/web/src/queries/provider.test.tsx (new)
- Tests first: T-WEB-16
- Do:
  - A client QueryProvider (stale time 30 seconds, devtools only in development) and prefetch(queryKey, fn) for server components that returns a dehydrated state for HydrationBoundary.
- Verify: `npm test --workspace @smart-finances/web -- src/queries/provider.test.tsx` → pass
- Done when: verify is green, evidence is in progress-smart-finances.json
### SF-111 · Build the shell: rail, top bar and account area
- Implements: AC-4, AC-10, D-24, D-35 to D-44, D-36, D-46, D-137 · After: SF-101, SF-109, SF-110 · Judgment: normal
- Files: apps/web/src/app/(app)/layout.tsx (new), apps/web/src/ui/Shell.tsx (new), apps/web/src/app/api/lang/route.ts (new), placeholder pages apps/web/src/app/(app)/{overview,transactions,review,imports,rates,data}/page.tsx (new), apps/web/e2e/shell.spec.ts (new)
- Tests first: T-WEB-10, T-WEB-11
- Do:
  - Server shell with the menu panel as the only client island; rail per D-35 to D-42 (Money without Ask, Account; no Prototype group); top bar under 960px (D-43, D-44); a placeholder address until PR 3.
  - /api/lang: POST, Origin must equal WEB_ORIGIN, sets the lang cookie; the address is kept; html lang follows; focus moves to the h1 after navigation. The e2e adds a dummy __Host-sid cookie.
- Verify: `npm run e2e --workspace @smart-finances/web -- e2e/shell.spec.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances.json
### SF-112 · Add not-found, error and the sign-in placeholder
- Implements: AC-8, AC-15, D-101 · After: SF-111 · Judgment: normal
- Files: apps/web/src/app/not-found.tsx (new), apps/web/src/app/error.tsx (new), apps/web/src/app/(auth)/sign-in/page.tsx (new, a placeholder PR 3 completes), apps/web/e2e/states.spec.ts (new)
- Tests first: T-WEB-12
- Do:
  - One not-found screen with a link to the overview; error.tsx shows the plain failed message with a retry.
  - The sign-in placeholder shows "signed out after 30 minutes without activity" when the address has reason=idle.
- Verify: `npm run e2e --workspace @smart-finances/web -- e2e/states.spec.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances.json
### SF-113 · Add Lighthouse CI budgets
- Implements: D-134 · After: SF-111 · Judgment: normal
- Files: apps/web/lighthouserc.json (new), apps/web/scripts/lhci.test.mjs (new)
- Tests first: T-WEB-17
- Do:
  - Phone settings against `next start` with STAGE=test on every money page: largest contentful paint ≤ 2.5 s, layout shift ≤ 0.1, first-load JavaScript per route ≤ 200 KB; script lhci.
- Verify: `npm run lhci --workspace @smart-finances/web` → budgets pass
- Done when: verify is green, evidence is in progress-smart-finances.json
### SF-114 · Write ADR 0008 and update the README
- Implements: D-62, D-65, D-89, D-93, D-102, D-138 · After: SF-103 · Judgment: normal
- Files: docs/adr/0008-web-framework-and-host.md (new), docs/adr/README.md, smart-finances:README.md
- Tests first: none
- Do:
  - ADR 0008 (0004 to 0007 are taken): Next.js on Amplify, the adopted console app, CI-started builds, one region, the hexagonal server; its row in docs/adr/README.md.
  - README "Layout": apps/web is the Next.js app and packages/contracts is shared; "Status": the Vercel project stays off.
- Verify: `npm test` → still green
- Done when: verify is green, evidence is in progress-smart-finances.json

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
