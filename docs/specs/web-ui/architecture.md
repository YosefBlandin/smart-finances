---
spec: web-ui
ticket: none
tier: L
status: locked-v1
---
# Web UI: design system and screens: architecture

<!-- Design by component. Cite code as <repo>:<path>#<Symbol>, never with line numbers; the drift script checks these refs. Add (new) after a file or symbol that a task creates. Cite ACs and decisions by id and never restate them. Executors read only the sections their tasks cite, so each section must stand on its own. -->

## Overview
<!-- 3 to 6 lines: the shape of the change and the data flow. -->
A Next.js 15 app in apps/web, built and served by the Amplify app the owner created in the console (D-102), in us-east-1 like every other stack (D-89). CI deploys the stacks, then starts the Amplify build (D-93). The web server is the only thing the browser talks to apart from file uploads: it runs sign-up and sign-in with the sign-in service itself (D-66, D-73), keeps pre-auth and session state in server-side rows behind opaque cookies (D-72, D-91), and calls the data API with the person's access token (D-53, D-82). Window counters and a proof-of-work check limit automated traffic (D-120); the web server refuses breached passwords (D-117); alarms watch the whole path (D-80).

```
browser ─https─▶ Amplify (CDN) ─▶ Next.js web server ───────── ──▶ sign-in pool (confidential client)
   │  __Host-pre / __Host-sid cookies only        │  sessions table, accounts table
   │                                              └─ Bearer access token ─▶ HTTP API ─▶ handlers
   └─ fetch FormData (presigned) ─────────────────────────────────────────▶ upload bucket
```

## Components
<!-- One subsection per component that changes. -->

### Web app (Next.js)
- Where: smart-finances:apps/web/package.json, apps/web/next.config.ts (new), apps/web/src/app/ (new), apps/web/src/middleware.ts (new), apps/web/amplify.yml (new), apps/web/.storybook/ (new).
- What: App Router. A server shell (layouts, rail, static text) with client islands for the interactive screens (D-137); routes in Contracts, "Web routes". The rail, top bar and account area follow D-24, D-35 to D-44; the Ask link and assistant screens are not built (D-46); the prototype-only nav group is not built (D-36).
- Interactivity: TanStack Query in the browser over the same-origin JSON routes /api/data/* (D-127, D-130); the server prefetches and hydrates the first view; filters, sort and paging update without a page load and keep month, view, kind, category and sort in the address; free text stays in the form (D-82). Optimistic updates for review choices, approvals and rates only (D-131).
- Forms: server actions through guarded() (D-125); Zod at every boundary (D-124).
- Loading: skeletons for loading content, a spinner only inside the busy button (D-128).
- Middleware sets a fresh nonce and the content policy on every response and redirects by cookie presence only (D-108). The server-only guard loads the session, checks consent and refuses an account marked deleting except on its finish action (D-104).
- 403 and 404 both show one "not found" screen. A kept path is resumed with a GET after sign-in; the sign-in screen says when the session ended for idle time.
- Accessibility: html lang follows the language; focus moves to the main heading after navigation; field errors use aria-describedby and the form message role=alert; import status goes to a polite live region; reduced motion is honoured (AC-10).
- Quality: ESLint (Next.js, React Hooks, jsx-a11y) and Prettier (D-132); Storybook with the accessibility add-on and interaction tests, in CI only (D-129, D-136); Lighthouse CI budgets (D-134); CloudWatch RUM in the browser (D-135).
- Serves: AC-4, AC-6, AC-8, AC-10, AC-16; D-24, D-35 to D-46, D-71, D-82, D-83, D-124 to D-137.

### Code structure (D-138)
```
apps/web/src/
  domain/       pure TypeScript: money (kept, typical and bad month), limit windows, password rules,
                session policy (idle, absolute), consent, deletion steps. Imports nothing but domain/ and @smart-finances/contracts.
  application/  use cases: auth (signUp, confirm, resend, signIn, setup, code, consent, reset, signOut),
                account (deleteAccount, finishDeletion), data (listTransactions, getOverview, review, setRate,
                requestImport, erase), guard (requireMoneyAccess), pow. Import domain/ and ports/ only.
  ports/        IdentityProvider, SessionStore, PreAuthStore, AccountStore, Counter, PowStore, DataApi,
                BreachChecker, SecretStore, Settings, Clock, Logger, ParameterStore.
  adapters/     cognito.ts, dynamodb/ (sessions, pre-auth, accounts, counters, pow), data-api.ts (fetch + contracts),
                pwned.ts, secrets.ts, ssm.ts, env-settings.ts, log.ts, memory/ (every port, for STAGE=test and Storybook), container.ts.
  app/          Next.js delivery: pages, layouts, actions.ts files (server actions through guarded()),
                api/ JSON routes; calls application/ through container.ts only.
  ui/ screens/ queries/ i18n/ styles/   presentation: parts, screen components, TanStack hooks, next-intl, tokens.
```
- Dependency rule: domain ← application ← adapters and app; ui, screens and queries never import adapters or application directly (queries call /api/data/*, screens receive data or call actions). Enforced by ESLint import/no-restricted-paths (D-132).
- container.ts picks real adapters, or memory/ when STAGE=test; nothing else reads STAGE to choose behaviour.
- Serves: D-124, D-125, D-127, D-133, D-137, D-138.

### Design tokens and parts
- Where: apps/web/src/styles/tokens.css (new), apps/web/src/styles/base.css (new), apps/web/src/ui/ (new).
- What: the prototype's custom properties copied as they are, light and dark, theme from the system setting; parts use only tokens, through CSS modules (D-57). Fonts through next/font from local files (D-58); Tabler outline icons at 2px (D-17). Red: the bad money figure (AC-11) and error notes or failed statuses (D-63), never a second money figure.
- The prototype is extended first with every auth and account screen and its states (D-100).
- Serves: AC-10, AC-11; D-12, D-13, D-15 to D-17, D-21, D-22, D-25, D-27, D-32 to D-34, D-57, D-58, D-63, D-100.

### Words and formats
- Where: apps/web/messages/en.json (new), apps/web/messages/es.json (new), apps/web/src/i18n/request.ts (new), apps/web/src/i18n/format.ts (new).
- What: next-intl without locale routing (D-126): the lang cookie, else Accept-Language, picks en or es; ICU messages with zero, one and other forms (D-19); the same keys in both files, checked by a test. Amounts per D-23 and D-30 through next-intl's number formatting. Every error code and auth outcome maps to a message. Skipped-row reasons per D-86. /privacy and /terms exist in both languages under one version id. Sign-up and reset emails go out in the person's language through the pool's custom message trigger.
- Serves: AC-4, AC-5, AC-8, AC-14; D-10, D-11, D-19, D-23, D-30, D-42, D-83, D-86, D-126.

### Auth flows (web server)
- Where: apps/web/src/application/auth/ (new): signUp.ts, confirm.ts, signIn.ts, reset.ts, signOut.ts; apps/web/src/application/account/deleteAccount.ts (new); apps/web/src/app/(auth)/ (new) screens with actions.ts.
- Calls the pool with the confidential client (secret hash) (D-73). Before sign-up and reset it checks the new password against the Pwned Passwords range API (D-117). The client IP for the counters is the right-most X-Forwarded-For entry added by Amplify's CDN, never the left-most; a qa check confirms the header.
- Between steps the state lives in the pre-auth row (D-91); a completed sign-in deletes it and issues a new __Host-sid.
- At the first completed sign-in the consent from the pre-auth row is written to the accounts table before any money screen (D-87); a person without a consent row sees the consent screen.
- Every auth form is a server action through guarded() (D-125): the Origin against the stage's web address (D-115), then the proof-of-work answer, then the window counters (D-120); a refusal shows the "too many tries" message with the wait.
- Sign-up, reset and sign-in give the same message and timing for known and unknown emails. A sign-up for an existing unconfirmed email replaces it with the new password (D-106); code emails are capped per email (Limits).
- After a reset: global sign-out, session rows removed and a notice email (D-92, D-115). Delete account: D-104, after a full re-sign-in. Lost authenticator: the owner's runbook in Docs (D-115).
- Logs: one security event per outcome (Contracts); the logger refuses fields named password, code, secret or token.
- Serves: AC-1, AC-12, AC-13, AC-14, AC-17, AC-18, AC-19, AC-20; D-66, D-73, D-75, D-87, D-91, D-92, D-103, D-104, D-106, D-115, D-117, D-120.

### Sessions and accounts
- Where: apps/web/src/application/session.ts (new), apps/web/src/adapters/dynamodb/{sessions,accounts}.ts (new); tables in smart-finances:infra/lib/web-stack.ts#WebStack (new).
- Sessions: D-72. The key is the SHA-256 of the cookie id, so a table read cannot be replayed as a cookie. Every read checks expires_at and last_seen_at itself; the TTL only cleans up. Refresh on the server when the access token has under 5 minutes left. Sign out removes the row and revokes the refresh token.
- Accounts: one row per person with consent, status (active or deleting) and the per-person caps, reserved by one conditional update (D-87, D-104, D-114).
- Serves: AC-14, AC-15, AC-16, AC-17, AC-18; D-72, D-87, D-91, D-104, D-114.

### Data access (web server)
- Where: apps/web/src/adapters/data-api.ts (new), apps/web/src/application/data/ (new), apps/web/src/app/api/data/ (new), apps/web/src/queries/ (new), server actions in apps/web/src/app/(app)/*/actions.ts.
- Server reads: the data-api adapter adds the access token, times out at 5 seconds (D-101), parses every reply with the shared Zod schema (D-133), keys errors on HTTP status (401: one refresh, then signed out; 403 and 404: not found; 409, 429 and 5xx: failed state with retry) and counts the request against the person's limit.
- Browser reads: /api/data/* JSON routes (one per data read: transactions, totals, rates, review, imports, import) check the session and consent, call a read use case and return the parsed JSON; TanStack Query hooks in queries/ use them, with infinite queries for cursor paging and a stale time of 30 seconds (D-127, D-130).
- Changes: server actions (review choice, rate, import request, erase, delete account), each through guarded() (D-125); review and rate mutations are optimistic and roll back on error, then invalidate totals (D-131); the others wait for the answer.
- Imports: the action reserves a cap slot and checks the pause switch (D-114), asks POST /imports and returns the presigned form; the browser sends the file with fetch and FormData; the import query polls until a final status.
- Serves: AC-5, AC-6, AC-7, AC-9, AC-15, AC-17; D-53, D-82, D-96, D-101, D-114, D-124, D-125, D-127, D-130, D-131.

### Screens
- Where: apps/web/src/app/(app)/overview, transactions, review, imports, rates, data (new).
- Overview: totals and rates for the month and up to six before it; kept, typical month (D-20, D-85) and the bad-month case (D-26 to D-31); the waiting line; SVG charts with a table alternative (D-57); net worth hidden (D-18). Each section fails alone (D-101).
- Transactions: every filter, sort and page is a request (AC-6). Review: category or approve for payments-report rows; other sources show the fix-in-source note (F-11). Imports: source, name check, upload, status, skipped rows (AC-5).
- Your data: export; "Erase my data" with the typed word DELETE, the 35-day note and counts (AC-7); "Delete my account" after a full re-sign-in, its own warning (data, sign-in and consent removed; backups kept 35 days) and a signed-out result with counts (AC-18).
- Imported text renders only as text nodes; no raw HTML insertion, no markdown renderer (AC-9; its assistant half moves to Epic 4 with D-46).
- Serves: AC-2, AC-5 to AC-9, AC-11, AC-18; D-18 to D-21, D-23, D-26 to D-31, D-34, D-85, D-101, D-104.

### Screen states
| Screen | Loading | Empty | Failed | Partial or blocked | No access or signed out | Next step |
|---|---|---|---|---|---|---|
| overview | nothing until render; skeleton on in-app navigation | no money in yet | a section's own failed note | no rate; fewer than 3 rated months (D-85) | to sign-in, path kept | import; add the rate; retry the section |
| transactions | as overview | nothing matches | could not load | erase window | not found | widen months; retry |
| review | as overview | nothing to review | could not load | other source: fix in the file | not found | open imports |
| imports | as overview | no imports yet | upload refused (reason) | running, stalled, never arrived, skipped rows; daily cap or pause | to sign-in | repair; upload again; wait |
| rates | as overview | no months to rate | could not save | none | to sign-in | add a rate |
| your data | none | nothing stored | erase or delete may be unfinished | import running; erase window | to sign-in | finish erasing; finish deleting |
| sign-up | button busy | none | same message for any email; disposable or not allowed | too many tries (wait) | signed in: to overview | check your email |
| confirm | button busy | none | wrong or expired code | locked for a while | none | send a new code |
| setup and code | button busy | none | wrong code | challenge expired: back to password | none | lost authenticator page |
| reset | button busy | none | wrong code; breached password | too many tries | none | sign in again |

### Sign-in pool changes
- Where: smart-finances:infra/lib/data-stack.ts#DataStack.
- What: self sign-up on; the Lite plan stays, no threat protection (D-117); password policy per Contracts; a new confidential web-server client (secret, password flow, refresh; access token 60 minutes, refresh token 12 hours, challenge session 15 minutes); its secret copied into a Secrets Manager secret in this stack, whose ARN (never the value) is a stage parameter. Pre-sign-up trigger per D-98 and D-109; custom message trigger for the email language. Triggers take no pool or client id from their environment; they read stage parameters at run time (D-109). Email through SES once the owner's domain exists (D-77).
- The public SRP client stays only until the web server signs in on qa, and goes before any stage opens sign-up (D-98). Meanwhile the API's audience lists both clients (smart-finances:infra/lib/api-stack.ts#ApiStack).
- Stays the same: the pool itself (not replaced; a synth test checks), email sign-in, TOTP required, email-only recovery.
- Serves: AC-12, AC-13, AC-19, AC-20; D-73, D-77, D-98, D-109, D-117.

### Data service changes
- Where: smart-finances:infra/lib/api-stack.ts#ApiStack, smart-finances:infra/lib/data-stack.ts#DataStack.
- What: stage throttle 50 per second, burst 100; no API browser rule; the data stack stops managing the bucket's browser rule (D-88). Reserved concurrency for the read handler and a cap for the parser once the quota is raised (D-95). Quotas, sizing and owner-only alarms go to the data-architecture spec as follow-ups (D-81).
- Serves: AC-15, AC-17; D-81, D-88, D-95.

### Shared contracts package
- Where: packages/contracts (new) with Zod schemas for every data route, FIELDS, KINDS and CATEGORIES; smart-finances:apps/api/src/ingest/schema.mjs#FIELDS and smart-finances:apps/api/src/ingest/categories.mjs#categoryFor re-export or import from it; smart-finances:package.json gains packages/* in workspaces.
- Why: one source of truth for the API and the web (D-133); the schema module loads the server's hashing module (F-13), so the lists move to a browser-safe package.
- The data PRs validate with the same schemas as they build the routes (a follow-up row in the data-architecture spec).
- Serves: AC-6; D-124, D-133.

### Web stack
- Where: smart-finances:infra/lib/web-stack.ts#WebStack (new), smart-finances:infra/lib/stage.ts#addStage, smart-finances:infra/lib/stage-values.ts#readStageValues.
- Adopts the Amplify app by the amplify-app-id stage parameter (D-102). Custom resources set the app's platform to web compute and its service and compute roles, set the branch's auto-build off, its compute role and its variables (merged, D-110), and put the upload bucket's browser rule (D-88, D-93). They may pass only those two roles and clear them on delete (D-111).
- Owns: the Amplify service role (write to /aws/amplify/<app id>, which it references and sets to one month, D-112), the compute role, the sessions table, the accounts table (retained, point-in-time recovery and deletion protection on staging and prod, D-111), the hourly housekeeping function (D-104, D-106, D-107), and the RUM app monitor with its guest identity pool, whose role may only put RUM events to that monitor (D-135). No WAF (D-120).
- The compute role may: read the client secret and the stage parameters; read and write both tables; admin get, delete and global sign-out on this pool only (D-92, D-104). The housekeeping function may also list users on this pool and invoke the data service's delete function (D-104, D-106).
- Serves: AC-15 to AC-19; D-72, D-87, D-88, D-89, D-91 to D-93, D-102, D-104, D-106, D-107, D-110 to D-112, D-135.

### Alarms
- Where: smart-finances:infra/lib/alarms-stack.ts#AlarmsStack (new); apps/web/src/adapters/log.ts (new).
- What: one SNS topic per stage with the owner's email, the alarms in Contracts, one dashboard (D-80). Metric filters on /aws/amplify/<app id>; the hourly job calls /api/health (D-107), and a missing health line for an hour breaches, so a silent log pipe alarms.
- Serves: AC-17, AC-19; D-80.

### CI and build
- Where: smart-finances:.github/workflows/deploy.yml, smart-finances:infra/lib/github-oidc-stack.ts, apps/web/amplify.yml (new), apps/web/lighthouserc.json (new).
- deploy.yml, before credentials: lint and format check (D-132), web unit tests, browser tests, the Storybook build with its accessibility and interaction tests (D-136), and Lighthouse CI on the fixtures (D-134). Then deploy data, API, web and alarms; start the Amplify job for the commit and poll /api/health until it reports that sha; check the headers against the contract (D-93, RK-2, RK-3).
- The owner redeploys the OIDC stack with Amplify job rights on each stage's app and read of amplify-app-id (D-113). The poll waits at most 15 minutes; the job limit is 45 minutes. amplify.yml runs lint and the web unit tests, then writes the settings and commit id into .env.production, then builds (D-110).
- Serves: D-59, D-93, D-132, D-134, D-136.

### Docs
- docs/adr/0008-web-framework-and-host.md (new): D-62, D-65, D-89, D-93, D-102. docs/adr/0009-sessions-and-sign-up.md (new): D-72, D-73, D-87, D-91 to D-93, D-98, D-104, D-115, D-117, D-120.
- smart-finances:docs/threat-model.md: open sign-up, the web server, the sessions and accounts tables and the secret as trust boundaries; B1 updated; "single user" leaves the out-of-scope list.
- docs/runbooks/lost-authenticator.md (new): identity proof, 72-hour wait, admin MFA reset, global sign-out, session rows removed, notice email (D-115).
- README.md, "Layout" and "Status"; the data-architecture spec's decisions get the follow-up rows for D-81 and D-95.

## Contracts
<!-- The single home for every interface that crosses a boundary. -->

### Data API
The routes, shapes, error codes and paging are the data-architecture spec's: docs/specs/data-architecture/architecture.md, Contracts, "HTTP routes". This spec adds none. The web server sends authorization: Bearer <access token>; the API's audience check takes the web-server client id, which the access token carries as client_id (D-53).

### Ports (D-138)
Every port is a TypeScript interface in apps/web/src/ports/; results never throw for expected failures, they return { ok: false, reason }. Times are epoch milliseconds from Clock.
| Port | Methods |
|---|---|
| Clock | now(): number |
| Settings | get(): Settings (the Web server settings, Zod-parsed) |
| SecretStore | get(arn): Promise<string> |
| ParameterStore | get(name): Promise<string \| undefined> (60-second cache) |
| Logger | event(name, outcome, { sub?, requestId }): void |
| SessionStore | create(row): Promise<void>; get(idHash); touch(idHash, now); delete(idHash); listBySub(sub); deleteBySub(sub) |
| PreAuthStore | create(row); get(idHash); update(idHash, patch); delete(idHash) |
| Counter | incr(key, windowStart, ttl): Promise<number> |
| PowStore | claim(saltHash, ttl): Promise<boolean> (true only the first time) |
| AccountStore | getAccount(sub); putConsent(sub, consent); markDeleting(sub, now); reserveImport(sub, { day, bytes, importId }): Promise<{ ok } \| { ok: false, reason: 'daily' \| 'bytes' \| 'running' }>; releaseImport(sub, importId, finalBytes); resetStoredBytes(sub); deleteAccountRow(sub) |
| BreachChecker | isBreached(password): Promise<boolean \| 'unavailable'> |
| IdentityProvider | signUp(email, password, lang); confirm(email, code); resend(email, lang); passwordAuth(email, password) → { tokens } \| { challenge: 'MFA_SETUP' \| 'SOFTWARE_TOKEN_MFA', session }; associate(session) → { secret, session }; verifySetup(session, code); respondCode(email, session, code) → { tokens }; forgot(email, lang); confirmForgot(email, code, password); refresh(sub, refreshToken) → tokens; revoke(refreshToken); adminGet(email) → { sub, status }; adminDelete(sub); adminGlobalSignOut(sub) |
| DataApi | one method per route in @smart-finances/contracts (listTransactions, totals, rates, putRate, review, putReview, listImports, getImport, requestImport, exportCsv, erase), each (token, input) → { ok, data } \| { ok: false, kind: 'unauthorized' \| 'not_found' \| 'conflict' \| 'limited' \| 'failed', code?, retryAfter? } |
Tokens = { access, id, refresh, expiresAt }. The Cognito username is the email for sign-in calls and the sub for refresh (secret hash).

### Interfaces between the PRs
What each PR (pr-smart-finances*.md) provides to the later ones. A later PR imports these names; it never redefines them. Paths are under apps/web/src unless stated.
- PR 1: packages/contracts (@smart-finances/contracts: FIELDS, KINDS, CATEGORIES, Zod schemas per data route); apps/web scripts test, e2e (STAGE=test, port 3000), lint, storybook, test-storybook, lhci; messages/en.json and es.json with next-intl; ui/ parts with stories; queries/provider.tsx and prefetch(); ports/ interfaces and adapters/memory/; adapters/container.ts; (app) layout and (auth) group; fixtures in apps/web/fixtures/sample.json. Until PR 3, code reads process.env (STAGE, COMMIT_SHA, UPLOAD_HOST, WEB_ORIGIN) with test defaults.
- PR 3: ports Settings, SecretStore, Logger, SessionStore, PreAuthStore, Counter, PowStore, BreachChecker, IdentityProvider, AccountStore with real adapters; application/session.ts getSession() → { sub, email, accessToken, … } | null, createSession, refreshIfNeeded, signOutEverywhere(sub); domain/limits.ts and application hit(scope, value) → { ok, retryAfterSeconds }; app/guarded.ts guarded(schema, opts, fn) → { ok, data } | { ok: false, messageKey, retryAfterSeconds? }; application/guard.ts requireMoneyAccess({ allowDeleting? }); application/auth/signIn.ts signIn(email, password, { reauth? }); legal/versions.ts TERMS_VERSION and PRIVACY_VERSION ("2026-11-01"); the memory identity fake (email code 123456, authenticator code 000000); e2e/helpers/signIn.ts.
- PR 4: ports DataApi and ParameterStore with adapters; application/data/* use cases; app/api/data/* JSON routes and export; queries/ hooks; domain/money.ts overviewModel; application/account/deleteAccount.ts; /goodbye.

### Web routes
| Path | Who | Purpose |
|---|---|---|
| /sign-up, /sign-up/confirm, /sign-in, /sign-in/code, /sign-in/setup, /reset, /reset/confirm, /lost-authenticator | signed out | auth screens (D-66, D-103) |
| /consent | signed in, no consent row | accept the current versions (D-87) |
| /privacy, /terms | anyone | both languages, one version id each |
| /overview, /transactions, /review, /imports, /rates, /data | signed in with consent | money screens |
| /api/auth/pow | anyone, GET | a proof-of-work challenge (D-120) |
| /api/data/* | signed in with consent, GET | JSON reads for TanStack Query (D-127) |
| /api/data/export | signed in with consent, GET | the CSV download |
| /api/lang | anyone, POST | sets the lang cookie |
| /api/health | anyone | { sha, stage } for the deploy check and the heartbeat |
| /goodbye | anyone | after delete account: the counts from a 5-minute signed, HttpOnly goodbye cookie |
| /too-many | signed in | the person limit page with the wait |

Every change is a server action through guarded() (D-125), not a route.

Search values: month (yyyy-mm), view (native or usd), kind, category, sort. Free text stays in the form (D-82).

### Cookies
- __Host-sid: 32 random bytes, base64url; Secure; HttpOnly; SameSite=Lax; Path=/; no Max-Age.
- __Host-pre: 32 random bytes; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age 900; deleted when sign-in completes.
- CSRF: every post's Origin must equal the stage's web address from the settings; missing or null is refused (403); no GET changes state; sign-out is a post (D-115).
- lang: en or es; SameSite=Lax; one year.
Nothing else is written to browser storage.

### Sessions table (DynamoDB, on demand, TTL on expires_at)
| Item | Key | Fields |
|---|---|---|
| session | pk SID#<sha256 of id> | sub, access_token, id_token, refresh_token, created_at, last_seen_at, expires_at (+12 h) |
| pre-auth | pk PRE#<sha256 of id> | step, email (needed for confirm and code; never logged), email_hash, challenge_session, totp_secret?, accepted_versions, lang, attempts, expires_at (+15 min) |
| pow | pk POW#<sha256 of salt> | expires_at (+10 min) |
| counter | pk RL#<scope>#<value>#<window start> | n, expires_at (window end + 1 min); value is an HMAC of the email or address prefix, or the sub (D-115) |
| GSI | sub | every session of a person |
Idle 30 minutes; absolute 12 hours; a new id at every sign-in.

### Accounts table (DynamoDB, on demand, no TTL)
pk ACCT#<sub>: consent { terms_version, privacy_version, lang, accepted_at }, status (active or deleting), deleting_since?, imports_today { day, n }, running_import_id?, stored_bytes. Erase-all resets stored_bytes and keeps the row; delete account removes it last.

### Limits (D-96, D-114, D-120)
| Scope | Limit | Where | On excess |
|---|---|---|---|
| sign-up and auth posts | a proof-of-work answer issued by the server, valid 10 minutes, one use | web server | "reload and try again" |
| auth posts per IP | 20 per 5-minute window | counter | same message, wait shown |
| sign-in or reset failures per email and address prefix | 5 per 15-minute window | counter | same message, wait shown |
| code emails per email | 3 an hour, 10 a day | counter | same reply, no email sent (D-106) |
| data requests per person | 120 per 1-minute window | counter | 429 page (AC-17) |
| imports per person | 10 a day, 200 MiB stored, 1 running | accounts table | plain refusal |
| all imports | pause switch | stage parameter | plain refusal |
| sign-up email | web-server client only; not disposable; signup-open true (qa: true, D-118) | pre-sign-up trigger (D-109) | plain refusal (AC-19) |

### Password and code rules (D-75, D-117)
Length 12 to 128, any characters, no composition rules or expiry; breached passwords refused by the range check (D-117); TOTP required at first sign-in; the email code expires in 24 hours and the reset code in 1 hour; 5 wrong codes lock the step.

### Response headers (middleware, every response)
- Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-<n>' 'strict-dynamic'; style-src 'self' 'nonce-<n>'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://<upload bucket host> https://dataplane.rum.us-east-1.amazonaws.com https://cognito-identity.us-east-1.amazonaws.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'.
- Strict-Transport-Security max-age=31536000; X-Content-Type-Options nosniff; Referrer-Policy no-referrer; Permissions-Policy camera=(), microphone=(), geolocation=(); Cache-Control no-store on signed-in pages.
- Amplify custom headers set no content policy.

### Web server settings (D-110)
| Name | Source | Written by | Read by |
|---|---|---|---|
| STAGE, AWS_REGION | stage | WebStack, branch variables | server |
| API_URL | api-url parameter | WebStack | the data-api adapter |
| USER_POOL_ID, WEB_CLIENT_ID | DataStack parameters | WebStack | auth flows |
| WEB_CLIENT_SECRET_ARN, HMAC_SECRET_ARN | parameters | WebStack | server, read at run time through the compute role |
| SESSIONS_TABLE, ACCOUNTS_TABLE | WebStack | WebStack | session.ts, accounts.ts |
| UPLOAD_HOST | bucket-name parameter | WebStack | content policy |
| WEB_ORIGIN | the branch address | WebStack | Origin check |
| SUPPORT_ADDRESS | support-address parameter | WebStack | lost-authenticator page |
| COMMIT_SHA | Amplify's commit id | amplify.yml | /api/health |
amplify.yml writes these into apps/web/.env.production before next build; no secret value is ever a variable.

### Security events (web server log, one JSON line each)
{ "event": "signup" | "signup_confirm" | "signin" | "signin_fail" | "mfa_setup" | "reset" | "signout" | "account_delete" | "rate_limited" | "breached_password" | "breach_check_unavailable" | "health", "outcome", "sub"?, "request_id", "ts" }. Never an email, password, code, token, IP or imported text.

### Alarms (D-80, one SNS topic per stage)
| Alarm | Source | Threshold |
|---|---|---|
| sign-up spike | security events, signup | over 50 in 1 hour |
| sign-in failures | security events, signin_fail | over 100 in 15 minutes |
| rate-limit refusals | security events, rate_limited | over 500 in 5 minutes |
| web server errors | Amplify 5xx | over 2% for 10 minutes |
| API errors and throttles | HTTP API 5xx and 429 | over 2%, or any 429 for 5 minutes |
| function errors and throttles | Lambda, including housekeeping | any for 5 minutes |
| log heartbeat | health lines from the hourly job's call | missing for 1 hour (missing data breaches) |
| stuck deletion | accounts table, deleting older than 6 hours (hourly job metric) | any |
| email sender health | SES bounce and complaint rate | over 5% bounce or 0.1% complaint |
| cost | AWS Budgets (existing) | 50%, 80%, 100% |
| rollup failures | on-failure queue (existing) | any message |

### Stage parameters (new, /smart-finances/<stage>/)
| Name | Written by | Read by |
|---|---|---|
| amplify-app-id | a person, once (D-102) | WebStack, AlarmsStack, CI |
| web-client-id | DataStack | ApiStack (audience), WebStack (build setting) |
| web-client-secret-arn | DataStack | WebStack (compute role grant) |
| api-url | ApiStack | WebStack (build setting) |
| support-address | a person | WebStack (build setting, D-103) |
| signup-open | a person; false or missing means closed | pre-sign-up trigger, sign-up screen (D-109) |
| housekeeping-hmac-secret-arn | WebStack | compute role, housekeeping (counter keys, D-115) |
| imports-paused | a person, in an emergency | web server (D-96) |

## Alternatives
<!-- Only for real technical forks. -->

### Fork: where the session lives (D-72)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. Encrypted cookie holding the tokens | tokens over 4 KB need several cookies; a session cannot be ended from the server | a key in Secrets Manager | rejected |
| B. Opaque id in the cookie, tokens in a table | one read per request; sessions can be listed and ended | sessions table | chosen |

### Fork: per-person and per-address limits (D-120)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. WAF on the API | not possible on an HTTP API (F-44) | none | rejected |
| B. Limits at the pool | every call comes from the web server, so all people share its addresses (F-47) | none | rejected |
| C. WAF at the app's edge plus counters | about 8 to 12 dollars a month per stage | web ACL plus counters | rejected for now by the user (D-120) |
| D. Window counters and a proof-of-work check in the web server | floods reach compute; weaker against rotating addresses | counters, one small check | chosen |

### Fork: sign-in flow (D-73)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. The Amplify adapter with managed pages | experimental, and its pages are not ours (F-37); ruled out by D-66 | none | rejected |
| B. SRP from the server with a public client | no threat-protection context, no secret | none | rejected |
| C. Password flow from the server with a confidential client and context data | the password crosses our server and must never be logged (RK-6) | new client, secret | chosen |

### Fork: where consent is kept (D-87)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. In the data table through a new API route | a contract change in another spec; erase-all would delete it | new route | rejected |
| B. Custom pool attributes | cannot be removed later | pool change | rejected |
| C. An accounts table the web server owns | one more table | accounts table | chosen |

## States and exits
| State | Entered when | Exits when | On failure or timeout |
|---|---|---|---|
| sign-up | form posted with accepted terms | code sent: confirm | existing confirmed email: same screen; unconfirmed: replaced with the new password (D-106); closed, refused or limited: plain message |
| confirm | code screen | right code: sign in | wrong: try again; 5 wrong: wait; expired: new code (within the email cap); never confirmed: removed after 24 hours |
| password | sign-in posted | setup or code challenge | wrong email or password: one message; unconfirmed: code resent, confirm screen; limited: wait |
| setup | first sign-in | valid code from the new key: consent, then session | wrong code: same key; challenge expired after 15 minutes: back to password, remove the old entry in the app |
| code | later sign-ins | valid code: new session id, overview | wrong: try again; 5 wrong or expired: back to password; lost: lost-authenticator page |
| consent | no consent row | accepted: overview | refused: signed out |
| signed in | session created | sign out, idle 30 minutes, 12 hours, reset, delete | refresh refused or row expired: signed out, path kept |
| reset | posted | code sent if the email exists (same screen) | limited: wait |
| reset confirm | code and new password | changed: everywhere signed out (D-92), sign in again | wrong code or breached password: the reason |
| import | file chosen | final status | stalled: repair; still running after 15 minutes: say it continues |
| erasing | DELETE typed and pressed | 202 with counts | import running: refused; timeout or 5xx: may be unfinished, Finish erasing repeats it |
| deleting account | full re-sign-in, no running import | each D-104 step done: signed-out page with counts | a step fails: the same session can finish it; otherwise the hourly job finishes it through the delete function; 6 hours still deleting: alarm |

## Cross-cutting
- **Security and permissions:** OWASP ASVS 5.0 V6, V7, V3 and V14 and the OWASP Authentication, Session Management and CSRF cheat sheets are the checklist (D-75). The browser holds only opaque cookies (AC-16). CSRF: SameSite plus an Origin check on every post. The person comes only from the session; the API checks the token's sub (AC-15). Admin rights on the pool are limited to get, delete and global sign-out for the compute role and the housekeeping function.
- **Personal data and logs:** security events carry no email, IP or token. Amplify logs one month. Pre-auth rows hold an email hash, never the email. Fixtures and screenshots use data/synthetic only.
- **Performance and cost:** pages render per request (nonces, no streaming, D-101): one session read and up to four API reads on the overview. New costs per stage: no Cognito plan cost (Lite, D-117), no WAF (D-120); Amplify builds and compute, two on-demand tables, SES per email, one hourly function. Budgets alarm at 50, 80 and 100%.
- **Deploy and infrastructure:** release.md, "Rollout order" and "HUMAN needs".
- **Observability:** the alarms table, the heartbeat, one dashboard per stage, and the post-deploy health check.
- **Old clients:** none (D-2). The public SRP client goes before any stage opens sign-up (D-98).
- **Release order and rollback:** release.md.

## Risks
| RK | Risk | Likelihood | Impact | Mitigation or acceptance | Owner |
|---|---|---|---|---|---|
| RK-1 | The read and import routes are not merged, so screens are built against the contract alone. | high | high | packages/contracts is the one copy (D-133); fixture tests cover every screen; qa checks wait for the data PRs (D-64). | owner |
| RK-2 | An Amplify build fails or serves an old commit unnoticed. | medium | high | CI starts the job and polls /api/health for the sha (D-93); amplify.yml runs tests first. | owner |
| RK-3 | A missing or wrong content policy ships unnoticed. | low | high | The post-deploy check compares headers with the contract; a browser test checks the nonce policy locally. | owner |
| RK-4 | The compute role gives the server no credentials (F-45). | medium | high | A qa check in the first web task; any fallback becomes a new decision. | owner |
| RK-5 | A pool change replaces the pool and orphans the data. | low | high | A synth test asserts the pool's logical id and no replacement. | owner |
| RK-6 | The password crosses the web server and could be logged. | low | high | A logger test that refuses secret field names; a fresh review of every auth handler. | owner |
| RK-7 | Fake sign-ups run up cost or email reputation. | medium | medium | D-120, D-96, D-106 and the sign-up and SES alarms; accepted in D-67 and, on qa, D-118. | owner |
| RK-15 | Without threat protection, credential stuffing is caught only by the counters and the proof-of-work check. | medium | medium | Accepted in D-117; the sign-in failure alarm and TOTP on every sign-in limit the damage. | owner |
| RK-8 | Cognito's default sender caps emails per day before SES is ready. | high | medium | Only qa uses it (D-77); the per-email cap (D-106) and the sign-up spike alarm watch it. | owner |
| RK-9 | The data service was built for one owner (F-31). | high | medium | D-81, D-95, D-96 and the follow-up rows in the data-architecture spec. | owner |
| RK-10 | Legal duties are unmet when sign-up opens. | medium | high | Q-8 gates every stage's public sign-up (D-98). | legal |
| RK-11 | Chivo is wide, so Spanish wraps in tables, chips and the rail. | medium | low | Screenshots in Spanish at 400 and 1400 pixels, checked by a person. | owner |
| RK-12 | A few heavy imports use the account's Lambda concurrency and every read fails. | medium | high | The quota raise and reservations (D-95) before sign-up opens; a load check on qa. | owner |
| RK-13 | The log pipe breaks and the security alarms go silent. | low | medium | The hourly job's health call and the missing-data alarm (D-107). | owner |
| RK-16 | Without a firewall, a request flood runs the web server and costs compute. | medium | medium | Accepted in D-120; budget and web server error alarms; adding WAF later is one stack change. | owner |
| RK-14 | Node middleware or the SDK does not run as expected on Amplify. | medium | high | Middleware needs no SDK (D-108); a qa check in the first web task. | owner |
