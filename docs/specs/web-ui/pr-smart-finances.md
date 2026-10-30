---
spec: web-ui
ticket: none
tier: L
status: draft
---
# Web UI: design system and screens: brief for smart-finances (PR 1 of 4, foundation)

<!-- The executor's main document. It must stand alone: copy values in, and link only to sections a task cites. At most 6k tokens; comments do not count. Required reading (intent.md, this file and its Read first sections) stays under 15k. Before the lock, the cold-read dry run must find zero "cannot start" items. -->

- Goal: the prototype has every auth and account screen, and apps/web is a Next.js app with tokens, words, headers, parts and the shell.
- Implements: AC-4, AC-8, AC-9, AC-10, AC-11, AC-16, D-57, D-58, D-62, D-71, D-82, D-83, D-100, D-108, D-110
- Spec folder: /home/user/smart-finances/docs/specs/web-ui in a cloud session; locally <repo root>/docs/specs/web-ui. Read and write the spec there, on the branch named under Branch, never a copy elsewhere.
- Refs: smart-finances at the sha in intent.md refs. Before the first task: `git fetch origin qa feature/web-ui`, then `node ~/.claude/skills/spec/scripts/drift.mjs docs/specs/web-ui --strict` (exit 0; NEW lines are expected)
- Worktree: a cloud session's own checkout; locally <repo root>/.claude/worktrees/web-foundation (profile Notes)
- Branch: feature/web-foundation · Base: origin/feature/web-ui · Draft PR into feature/web-ui (D-121)
- Brief version: the locked-vN named in the handoff prompt; record it as pr-smart-finances.md@locked-vN in progress-smart-finances.json
- Order: PR 1 of 4.

## Read first
1. This file, all of it.
2. intent.md: Acceptance criteria, No-gos, Glossary.
3. architecture.md: Components "Web app (Next.js)", "Design tokens and parts", "Words and formats", "Shared field and category lists"; Contracts "Web routes", "Cookies", "Response headers", "Web server settings".
4. CLAUDE.md in the worktree.
5. test-matrix.md rows whose task is SF-101 to SF-110.

## HUMAN needs
- <HUMAN: review the extended prototype and say go before SF-108> · Blocks: SF-108
- <HUMAN: merge the spec branch claude/intent-web-ui-spec-ssm5mn into feature/web-ui so the spec and this brief are on the base> · Blocks: SF-100

## Global constraints
- D-6: Roles: the agent writes code, commits, pushes feature branches and opens draft PRs into qa; the user reviews, merges and promotes. Source: data-architecture spec D-4 (default).
- D-11: Language: English and Spanish, switchable. Spanish addresses people with tú.
- D-17: Icons: Tabler outline icons at a 2px line, which matches the stem of Chivo 400. They mark the current screen, statuses, review reasons, notes and assistant answers, always next to a word. Narrows D-15: bands now appear only where they carry a number (the spending strip, bars and the category key) plus the logo.
- D-22: Type and spacing rules: sizes 12, 14, 16, 20, 24, 32, 48 plus one display size; body 16, tables and data 14, uppercase labels 12 with one letter-spacing. Weights 400, 500 and 700, with 800 only for the display figure. Spacing uses only the 4px-based tokens. Text meets 4.5:1 contrast and input borders 3:1. Click targets are at least 32px, and 44px on touch screens.
- D-23: Amounts: summaries (the overview's colour field, category rows and places) show pesos as whole numbers and dollars with cents. Lists of single transactions keep exact cents in both currencies.
- D-36: Nav groups: Money (Overview, Transactions, To review, Imports, Dollar rates, Ask), Account (Your data) and Prototype (Sign-in flow, Design system). The one-link Assistant group goes; Sign-in flow moves to Prototype because it is not a screen of the real app.
- D-46: Assistant screens: designed now in the prototype and the design system; their code is built in Epic 4 against its real answer format.
- D-57: Styling: the prototype's CSS custom properties as tokens with CSS modules; no Tailwind or shadcn. Charts in hand-drawn SVG, each with a table alternative.
- D-58: Fonts (Chivo, Chivo Mono) and Tabler icons are bundled; no font or icon service at run time.
- D-62: Next.js with server rendering, and the session held by the web server in cookies page scripts cannot read; the browser never holds a token. Supersedes D-49 and D-52.
- D-63: Red is also allowed for errors and failed statuses (error notes, failed or expired imports, a wrong password). Among money figures it stays only on the one bad figure. Narrows D-13.
- D-71: Next.js 15 App Router in apps/web on Amplify web compute, one branch per stage (main is prod); app, branches and compute role in CDK, connected by a GitHub token in Secrets Manager; the Amplify build runs the web unit tests first.
- D-82: Data access on the server: server components read through one client that adds the token and counts requests; changes are Origin-checked route handlers; free-text search stays out of the address. Supersedes D-54.
- D-83: Language from a lang cookie, else Accept-Language; the language row also appears on sign-in screens. Supersedes D-55.
- D-100: The prototype gains every auth and account screen (sign-up, confirm, setup, sign-in, code, reset, lost authenticator, delete account, too many tries, not found) in both languages, and fixes its sign-in copy, before any screen is coded.
- D-101: No streaming on Amplify: a first load shows nothing until the server renders; each API read times out at 5 seconds; each overview section fails alone with its own retry; skeletons show only during in-app navigation.
- D-108: Middleware does only the nonce, the content policy and a cookie-presence redirect; the session, consent and deleting checks run in a server-only helper called by the money layout and every route handler.
- D-110: Web server settings: one contract table (architecture.md); the branch-variables custom resource merges into Amplify's map without dropping keys; amplify.yml writes the listed names and the commit id into .env.production before the build.
- D-115: Security baseline: OWASP ASVS 5.0 level 2. The Origin must equal the stage's web address from the settings; a missing or null Origin is refused; sign-out is a post; counter keys are an HMAC of the email or address prefix. A notice email goes out after a password reset or an authenticator reset. Lost-authenticator recovery asks a reply from the account email plus details only the person knows, waits 72 hours, then signs out everywhere. Narrows D-75 and D-103.
- D-121: Integration branch: the four PRs (foundation, infra, auth, screens) each open as a draft into feature/web-ui, in order; once all are merged there, one PR from feature/web-ui into qa ships infra and web in one merge. The agent commits, pushes its feature branches and opens draft PRs; the user reviews, merges and promotes. Narrows D-6.
- Values:
  - Prototype: https://claude.ai/code/artifact/10e1188c-9601-4133-9a2d-3502b0bc2ac6 (synthetic data only).
  - Packages allowed: next 15.x, react and react-dom 19.x, typescript, vitest, @playwright/test, @axe-core/playwright, @tabler/icons-react, @fontsource/chivo, @fontsource/chivo-mono.
  - Web tests: `npm test --workspace @smart-finances/web -- <file>` (vitest run); browser tests: `npm run e2e --workspace @smart-finances/web -- <file>`; the dev server on port 3000 with strictPort.
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
### SF-101 · Add every auth and account screen to the prototype
- Implements: AC-12, AC-13, AC-14, AC-18, AC-19, AC-20, D-100 · After: SF-100 · Judgment: normal
- Files: the prototype artifact (read and republish it with the Artifact tool; its link is in Values), apps/web/design/prototype-screens.md (new)
- Tests first: T-WEB-1
- Do:
  - Load the smart-finances-ui skill and follow its checks; read decisions D-1 to D-120 that it points to.
  - Add screens in English and Spanish: sign-up with terms and privacy acceptance and the proof-of-work note; confirm (resend, expired); setup with QR and key text; code; reset and reset confirm; lost authenticator; consent; delete account (re-sign-in, warning, partial failure, signed-out result with counts); too many tries; not found; signed out after idle.
  - Fix the copy: "Close the tab when you’re done" becomes "Sign out when you’re done; the session also ends after 30 idle minutes"; remove the temporary-password screen.
  - Republish, then list every new screen and state in prototype-screens.md with its catalogue keys.
  - Stop for the owner's review of the prototype (HUMAN need) before SF-108.
- Verify: the prototype-check scripts named in the skill, on the saved file → syntax, class and smoke checks pass; screenshots in both languages and themes exist
- Done when: verify is green, evidence is in progress-smart-finances.json
### SF-102 · Split browser-safe field and category lists out of the API
- Implements: AC-6, D-82 · After: SF-100 · Judgment: normal
- Files: smart-finances:apps/api/src/ingest/fields.mjs (new), smart-finances:apps/api/src/ingest/schema.mjs#FIELDS, smart-finances:apps/api/src/ingest/categories.mjs#CATEGORIES (new), smart-finances:apps/api/src/ingest/categories.mjs#categoryFor, smart-finances:apps/api/package.json, apps/api/test/fields.test.mjs (new)
- Tests first: T-WEB-2
- Do:
  - Move FIELDS and KINDS into fields.mjs with no imports; schema.mjs re-exports them unchanged.
  - Export CATEGORIES: the distinct rule categories in rule order, then Uncategorized.
  - Add an exports map to apps/api/package.json for "./fields" and "./categories" only.
- Verify: `node --test apps/api/test/fields.test.mjs` and the root `npm test` → all pass
- Done when: verify is green, evidence is in progress-smart-finances.json
### SF-103 · Scaffold the Next.js app with a health route
- Implements: D-71, D-110, D-59 · After: SF-100 · Judgment: normal
- Files: smart-finances:apps/web/package.json, apps/web/next.config.ts (new), apps/web/tsconfig.json (new), apps/web/vitest.config.ts (new), apps/web/playwright.config.ts (new), apps/web/src/app/layout.tsx (new), apps/web/src/app/api/health/route.ts (new), apps/web/src/app/api/health/route.test.ts (new), apps/web/amplify.yml (new), package.json
- Tests first: T-WEB-3
- Do:
  - Next.js 15 App Router, React 19, TypeScript; scripts dev (port 3000), build, start, test (vitest run), e2e (playwright test).
  - /api/health returns { sha: COMMIT_SHA, stage: STAGE } with Cache-Control no-store.
  - amplify.yml (monorepo, appRoot apps/web): npm ci at the root, the web unit tests, write the settings in architecture.md Contracts "Web server settings" and COMMIT_SHA from AWS_COMMIT_ID into apps/web/.env.production, then next build; artifacts .next.
  - Root `npm test` also runs the web unit tests.
- Verify: `npm test --workspace @smart-finances/web -- src/app/api/health/route.test.ts` → pass; `npm run build --workspace @smart-finances/web` → succeeds
- Done when: verify is green, evidence is in progress-smart-finances.json
### SF-104 · Copy the design tokens, fonts and icons
- Implements: AC-10, D-57, D-58, D-17, D-22 · After: SF-103 · Judgment: normal
- Files: apps/web/src/styles/tokens.css (new), apps/web/src/styles/base.css (new), apps/web/src/app/fonts.ts (new), apps/web/src/styles/tokens.test.ts (new)
- Tests first: T-WEB-4
- Do:
  - Copy every custom property from the prototype (light, dark media query, data-theme dark) into tokens.css unchanged.
  - Chivo and Chivo Mono through next/font/local from the @fontsource packages' woff2 files.
  - The test parses tokens.css and checks the D-22 sizes, weights and spacing tokens exist, and that no category colour is the bad red.
- Verify: `npm test --workspace @smart-finances/web -- src/styles/tokens.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances.json
### SF-105 · Add the language catalogues and formatters
- Implements: AC-4, D-11, D-19, D-23, D-30, D-83, D-86 · After: SF-103 · Judgment: normal
- Files: apps/web/src/i18n/en.ts (new), apps/web/src/i18n/es.ts (new), apps/web/src/i18n/format.ts (new), apps/web/src/i18n/lang.ts (new), apps/web/src/i18n/i18n.test.ts (new)
- Tests first: T-WEB-5, T-WEB-6
- Do:
  - Start the catalogues from the prototype's word list; same keys in both; none, one and many forms.
  - format.ts: pesos whole in summaries, dollars with cents, exact cents in transaction lists, whole percentages (D-23, D-30).
  - lang.ts: the lang cookie, else Accept-Language (es* → es, else en).
- Verify: `npm test --workspace @smart-finances/web -- src/i18n/i18n.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances.json
### SF-106 · Set the nonce content policy and security headers in middleware
- Implements: AC-16, AC-9, D-108, D-115 · After: SF-103 · Judgment: high
- Files: apps/web/src/middleware.ts (new), apps/web/src/middleware.test.ts (new), apps/web/e2e/headers.spec.ts (new)
- Tests first: T-WEB-7, T-WEB-8
- Do:
  - Per request: a fresh nonce; the headers exactly as architecture.md Contracts "Response headers"; UPLOAD_HOST from the settings.
  - Redirect by cookie presence only: no __Host-sid on a money route → /sign-in with the path kept; __Host-sid on an auth route → /overview. No AWS SDK in middleware (D-108).
  - The browser test loads a page and checks the policy and that no inline script runs without the nonce.
- Verify: `npm test --workspace @smart-finances/web -- src/middleware.test.ts` → pass; `npm run e2e --workspace @smart-finances/web -- e2e/headers.spec.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances.json, and the reviewer has no blocker
### SF-107 · Build the base parts
- Implements: AC-8, AC-10, AC-11, D-63, D-22, D-34 · After: SF-104 · Judgment: normal
- Files: apps/web/src/ui/ (new): Button, Field, Chip, Note, StateBlock, Table, CategorySquare, with *.module.css and ui.test.tsx (new)
- Tests first: T-WEB-9
- Do:
  - Parts use tokens only; busy state on Button; Field wires aria-describedby to its error; form message role=alert.
  - Note and Chip in red only for errors and failed statuses (D-63).
- Verify: `npm test --workspace @smart-finances/web -- src/ui/ui.test.tsx` → pass
- Done when: verify is green, evidence is in progress-smart-finances.json
### SF-108 · Build the shell: rail, top bar and account area
- Implements: AC-4, AC-10, D-24, D-35 to D-44, D-36, D-46 · After: SF-107, SF-101 · Judgment: normal
- Files: apps/web/src/app/(app)/layout.tsx (new), apps/web/src/ui/Shell.tsx (new), apps/web/e2e/shell.spec.ts (new)
- Tests first: T-WEB-10, T-WEB-11
- Do:
  - Rail per D-35 to D-42 with groups Money (no Ask) and Account; no Prototype group.
  - Top bar under 960px with the menu panel (D-43, D-44).
  - Language row switches the lang cookie and keeps the address; html lang follows; focus moves to the main heading after navigation.
- Verify: `npm run e2e --workspace @smart-finances/web -- e2e/shell.spec.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances.json
### SF-109 · Add the not-found, error and signed-out notices
- Implements: AC-8, AC-15, D-101 · After: SF-108 · Judgment: normal
- Files: apps/web/src/app/not-found.tsx (new), apps/web/src/app/error.tsx (new), apps/web/src/app/(auth)/sign-in/notice.ts (new), apps/web/e2e/states.spec.ts (new)
- Tests first: T-WEB-12
- Do:
  - One not-found screen with a link to the overview, used for 403 and 404 alike.
  - The sign-in screen shows "signed out after 30 minutes without activity" when the redirect says so.
- Verify: `npm run e2e --workspace @smart-finances/web -- e2e/states.spec.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances.json
### SF-110 · Write ADR 0004 and update the README
- Implements: D-62, D-65, D-89, D-93, D-102 · After: SF-103 · Judgment: normal
- Files: docs/adr/0004-web-framework-and-host.md (new), smart-finances:README.md
- Tests first: none
- Do:
  - ADR 0004: Next.js on Amplify web compute, adopted console app, CI-started builds, one region; cite the D ids.
  - README "Layout": apps/web is the Next.js app; "Status": the Vercel project stays off.
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
