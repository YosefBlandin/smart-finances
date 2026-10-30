---
spec: web-ui
ticket: none
tier: L
status: draft
---
# Web UI: design system and screens: architecture

<!-- Design by component. Cite code as <repo>:<path>#<Symbol>, never with line numbers; the drift script checks these refs. Add (new) after a file or symbol that a task creates. Cite ACs and decisions by id and never restate them. Executors read only the sections their tasks cite, so each section must stand on its own. -->

## Overview
<!-- 3 to 6 lines: the shape of the change and the data flow. -->
A Next.js 15 app in apps/web, built and served by Amplify Hosting from the GitHub repo, one branch per stage (D-65, D-71). Its web server is the only thing the browser talks to, apart from file uploads: it signs people up and in with the sign-in service itself (D-66, D-73), keeps the session in a server-side table behind an opaque cookie (D-72), and calls the data API with the person's access token (D-53, D-82). A firewall in front of the app limits and challenges automated traffic (D-76). The sign-in pool opens sign-up with breached-password checks (D-74, D-75). One alarm topic per stage watches sign-ups, sign-ins, errors, cost and the email sender (D-80).

```
browser ─https─▶ WAF (us-east-1) ─▶ Amplify: Next.js web server ──▶ sign-in pool (server-side flows, secret)
   │  __Host-sid cookie only                │  sessions table (hashed id, tokens, limits)
   │                                        └─ Bearer access token ─▶ HTTP API ─▶ handlers (data-architecture spec)
   └─ fetch FormData (presigned) ─────────────────────────────────▶ upload bucket
```

## Components
<!-- One subsection per component that changes. -->

### Web app (Next.js)
- Where: smart-finances:apps/web/package.json, apps/web/next.config.ts (new), apps/web/src/app/ (new), apps/web/src/middleware.ts (new), apps/web/amplify.yml (new).
- What: App Router with server components. Routes in Contracts, "Web routes". The rail, top bar and account area follow D-24, D-35 to D-44; the Ask link and assistant screens are not built (D-46); the prototype-only nav group is not built (D-36). Month and view live in the address; free-text search does not (D-82).
- Middleware sets a fresh nonce and the content policy on every response (Contracts, "Response headers"), loads the session for protected routes, and redirects to sign-in when there is none.
- Accessibility: html lang follows the language; focus moves to the main heading after navigation; import status changes go to a polite live region; reduced motion is honoured (AC-10).
- Serves: AC-4, AC-8, AC-10, AC-16; D-24, D-35 to D-46, D-71, D-82, D-83.

### Design tokens and parts
- Where: apps/web/src/styles/tokens.css (new), apps/web/src/styles/base.css (new), apps/web/src/ui/ (new).
- What: the prototype's custom properties copied as they are, light and dark, theme from the system setting; parts use only tokens, through CSS modules (D-57). Fonts through next/font from local files (D-58); Tabler outline icons at 2px (D-17). Red: the bad money figure (AC-11) and error notes or failed statuses (D-63), never a second money figure.
- Serves: AC-10, AC-11; D-12, D-13, D-15 to D-17, D-21, D-22, D-25, D-27, D-32 to D-34, D-57, D-58, D-63.

### Words and formats
- Where: apps/web/src/i18n/en.ts (new), apps/web/src/i18n/es.ts (new), apps/web/src/i18n/format.ts (new).
- What: one catalogue per language with the same keys and none, one and many forms (D-19); amounts per D-23 and D-30; every error code and auth outcome maps to a sentence. Language comes from the lang cookie, else the browser's Accept-Language (D-83). Importers' skipped-row reasons show a translated lead plus the importer's words as raw text (D-86).
- Serves: AC-4, AC-5, AC-8; D-10, D-11, D-19, D-23, D-30, D-42, D-83, D-86.

### Auth flows (web server)
- Where: apps/web/src/server/auth/ (new): signUp.ts, confirm.ts, signIn.ts, challenges.ts, reset.ts, signOut.ts, deleteAccount.ts; apps/web/src/app/(auth)/ (new) screens.
- Calls the pool with the confidential client (secret hash), passing the person's IP as context data (D-73, D-74). Flows and their states: "States and exits". Rules: D-75. Consent record before the account is confirmed (D-78). Delete account: D-79.
- Every auth post is a route handler that checks the Origin header against the site, the WAF token where the firewall challenged, and a per-address and per-email attempt counter in the sessions table (D-76).
- Responses never say whether an email has an account: sign-up, reset and sign-in give the same message and timing for known and unknown emails (D-75).
- Serves: AC-1, AC-12, AC-13, AC-14, AC-18, AC-19, AC-20; D-66, D-72 to D-79.

### Sessions
- Where: apps/web/src/server/session.ts (new); the sessions table in smart-finances:infra/lib/web-stack.ts#WebStack (new).
- What: D-72. A 32-byte random id in the cookie; the table key is its SHA-256, so a table read cannot be replayed as a cookie. The row holds the person's sub, the tokens, created and last-seen times, the per-person request counter (D-76) and a TTL at the absolute limit. Refresh happens on the server when the access token has under 5 minutes left. Sign out and delete account remove every row for the person (a sub index) and revoke the refresh token.
- Serves: AC-15, AC-16, AC-17, AC-18; D-72, D-76.

### Data access (web server)
- Where: apps/web/src/server/api.ts (new), apps/web/src/server/types.ts (new), apps/web/src/app/(app)/ (new) screens, route handlers for changes.
- What: server components read through api.ts, which adds the access token, keys errors on HTTP status (401: one refresh then sign out; 409 codes, 429 and 5xx: failed state with retry; bodies without the F-3 shape accepted) and counts the request against the person's limit. types.ts mirrors the data-architecture spec's HTTP routes and is the web's single copy (D-82).
- Changes (review choice, rate, erase, delete account, import request) are route handlers that check the session, the Origin and the limit; the button is busy while the request runs; after a change the page re-renders from the server (no client cache).
- Uploads: the route handler asks POST /imports; the browser sends the file with fetch and FormData to the returned URL; then the page polls the import through the server (States and exits).
- Serves: AC-5, AC-6, AC-7, AC-9, AC-15, AC-17; D-53, D-82.

### Screens
- Where: apps/web/src/app/(app)/overview, transactions, review, imports, rates, data (new).
- Overview: totals and rates for the month and up to six before it on the server; kept, typical month (D-20, D-85) and the bad-month case (D-26 to D-31); the waiting line from review and imports; hand-drawn SVG charts with a table alternative (D-57); net worth hidden (D-18).
- Transactions: every filter, sort and page is a request (AC-6). Review: category or approve for payments-report rows; other sources show the fix-in-source note (F-11). Imports: source, name check, upload, status, skipped rows (AC-5). Your data: export, erase-all with the typed word, the 35-day note and counts, and delete account (AC-7, AC-18).
- Imported text renders only as text nodes; no raw HTML insertion, no markdown renderer (AC-9; the assistant half of AC-9 moves to Epic 4 with D-46).
- States per screen are in "Screen states" below.
- Serves: AC-2, AC-5 to AC-9, AC-11, AC-18; D-18 to D-21, D-23, D-26 to D-31, D-34, D-85.

### Screen states
| Screen | Loading | Empty | Failed | Partial or blocked | Next step |
|---|---|---|---|---|---|
| overview | skeleton of the field and rows | no money in yet | could not load | month has no rate; fewer than 3 rated months (no comparison, D-85) | import a file; add the rate |
| transactions | skeleton rows | nothing matches | could not load | erase window (conflict after erase) | widen months; try again |
| review | skeleton rows | nothing to review | could not load | other source: fix in the file | open imports |
| imports | list skeleton | no imports yet | could not load; upload refused (reason) | running, stalled (repair), never arrived, skipped rows | repair; upload again |
| rates | skeleton | no months to rate | could not save | none | add a rate |
| your data | none | nothing stored | erase may be unfinished | import running (erase refused); erase window | finish erasing; export first |
| sign-in screens | button busy | none | the same plain message for any wrong value | locked for a while; check your email | try again later; reset password |

### Sign-in pool changes
- Where: smart-finances:infra/lib/data-stack.ts#DataStack.
- What: self sign-up on; Plus feature plan with threat protection, audit first then full (D-74); password policy per D-75; a new confidential web-server client with a secret, the password flow, refresh, and additional context data on; the old public client kept until the web server works, then removed (D-73). Email through SES once the owner's domain is verified (D-77). A pre-sign-up trigger blocks disposable email domains (D-76).
- The API's audience check accepts both client ids during the change (smart-finances:infra/lib/api-stack.ts#ApiStack); a new stage parameter carries the web-server client id.
- Stays the same: the pool itself (not replaced), email sign-in, TOTP required, email-only recovery.
- Serves: AC-12, AC-13, AC-19, AC-20; D-73 to D-77.

### Data service changes
- Where: smart-finances:infra/lib/api-stack.ts#ApiStack, smart-finances:infra/lib/data-stack.ts#DataStack.
- What: stage throttle raised to 50 per second, burst 100; the API's browser rule removed, since only the web server calls it; the upload bucket's browser rule lists the Amplify branch address (D-81). Per-person import quotas and the one-owner assumptions (F-31) are recorded as a follow-up in the data-architecture spec, owned there.
- Serves: AC-15, AC-17; D-81.

### Shared field and category lists
- Where: smart-finances:apps/api/src/ingest/fields.mjs (new) with FIELDS and KINDS, re-exported by smart-finances:apps/api/src/ingest/schema.mjs#FIELDS; smart-finances:apps/api/src/ingest/categories.mjs#CATEGORIES (new) beside smart-finances:apps/api/src/ingest/categories.mjs#categoryFor; an exports map in smart-finances:apps/api/package.json for these two files.
- Why: the schema module loads the server's hashing module (F-13); the review screen needs the category list.
- Serves: AC-6; D-82.

### Web stacks
- Where: smart-finances:infra/lib/web-stack.ts#WebStack (new), smart-finances:infra/lib/web-edge-stack.ts#WebEdgeStack (new), smart-finances:infra/lib/stage.ts#addStage, smart-finances:infra/bin/app.ts.
- WebEdgeStack, in us-east-1, one per stage: the CloudFront-scoped web ACL (D-76, F-43), its logging, and its ARN as a stage parameter.
- WebStack, in the main region: the Amplify app connected to the repo with a fine-grained GitHub token from Secrets Manager, platform web compute, app root apps/web, one branch for the stage, the compute role, the web ACL association, the sessions table, the client secret in Secrets Manager, and the build-time settings (D-71). The compute role may read that one secret and the stage parameters, and read and write the sessions table.
- Serves: AC-16, AC-17, AC-19; D-65, D-71, D-72, D-76.

### Alarms
- Where: smart-finances:infra/lib/alarms-stack.ts#AlarmsStack (new); apps/web/src/server/log.ts (new).
- What: one SNS topic per stage with the owner's email, the alarms in Contracts, and one dashboard (D-80). The web server writes one JSON line per security event (Contracts, "Security events"); metric filters turn them into counts.
- Serves: AC-17, AC-19; D-80.

### CI and build
- Where: smart-finances:.github/workflows/deploy.yml, apps/web/amplify.yml (new).
- deploy.yml: runs the web unit and browser tests before credentials; deploys the edge stack, then data, API, web and alarms; it never builds the web app for hosting.
- amplify.yml: npm ci at the root, the web unit tests, then the build; a failed test fails the Amplify build, so a red branch never ships (RK-2).
- After the Amplify build, a CI step polls the branch address until /api/health returns the commit sha, then checks the response headers against the contract (RK-2, RK-3).
- Serves: D-59, D-71.

### Docs
- docs/adr/0004-web-framework-and-host.md (new): D-62, D-65, D-71. docs/adr/0005-sessions-and-sign-up.md (new): D-72 to D-77.
- smart-finances:docs/threat-model.md: open sign-up, the web server and the sessions table as new trust boundaries; B1 updated; "single user" leaves the out-of-scope list.
- README.md, "Layout" and "Status"; the data-architecture spec's decisions get the follow-up rows for D-81.

## Contracts
<!-- The single home for every interface that crosses a boundary. -->

### Data API
The routes, shapes, error codes and paging are the data-architecture spec's: docs/specs/data-architecture/architecture.md, Contracts, "HTTP routes". This spec adds none. The web server sends authorization: Bearer <access token>; the API's audience check takes the web-server client id, which the access token carries as client_id (D-53).

### Web routes
| Path | Who | Purpose |
|---|---|---|
| /sign-up, /sign-up/confirm, /sign-in, /sign-in/code, /sign-in/setup, /sign-in/new-password, /reset, /reset/confirm | signed out | auth screens (D-66) |
| /privacy, /terms | anyone | privacy notice and terms, versioned (D-78) |
| /overview, /transactions, /review, /imports, /rates, /data | signed in | money screens |
| /api/auth/* | route handlers | the auth posts above, Origin-checked |
| /api/health | anyone | { sha, stage }, for the deploy check |

Search values: month (yyyy-mm), view (native or usd), kind, category, sort. Free text stays in the form, not the address (D-82).

### Session cookie
__Host-sid: 32 random bytes, base64url; Secure; HttpOnly; SameSite=Lax; Path=/; no Domain; no Max-Age (ends with the browser). lang: en or es; SameSite=Lax; one year; not HttpOnly. Nothing else is written to browser storage.

### Sessions table (DynamoDB, on-demand, TTL on expires_at)
| Item | Key | Fields |
|---|---|---|
| session | pk SID#<sha256 of id> | sub, access_token, id_token, refresh_token, created_at, last_seen_at, expires_at (created + 12 h) |
| person index | GSI on sub | finds every session of a person |
| counter | pk RL#<scope>#<value>#<minute> | n, expires_at (+2 minutes); scopes: person, ip-auth, email-auth (email as its SHA-256) |

Idle limit 30 minutes (last_seen_at), absolute 12 hours (expires_at); a new id at every sign-in and after a password change.

### Limits (D-76)
| Scope | Limit | Where | On excess |
|---|---|---|---|
| any request per IP | 1,000 per 5 minutes | WAF rate rule | block 429 |
| auth posts per IP | 20 per 5 minutes | WAF rate rule on /api/auth/* | CAPTCHA |
| sign-up page and post | every request | WAF challenge action | silent browser check |
| sign-in or reset per email | 5 per 15 minutes | sessions table counter | same plain message, retry later |
| data requests per person | 120 per minute | sessions table counter | 429 page, plain message (AC-17) |
| sign-up email domain | disposable list | pre-sign-up trigger | refused, plain message (AC-19) |

### Password and code rules (D-75)
Length 12 to 128, any characters including spaces, no composition rules, no expiry; breached passwords refused by threat protection; TOTP required at first sign-in; the email code and reset code expire as the pool sets (24 hours and 1 hour); 5 wrong codes lock the step.

### Response headers (set by middleware, every response)
- Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-<n>' 'strict-dynamic'; style-src 'self' 'nonce-<n>'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://<upload bucket host>; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'.
- Strict-Transport-Security max-age=31536000; X-Content-Type-Options nosniff; Referrer-Policy no-referrer; Permissions-Policy camera=(), microphone=(), geolocation=(); Cache-Control no-store on every signed-in page.
- Amplify custom headers set no Content-Security-Policy, so the middleware's is the only one.

### Security events (web server log, one JSON line each)
{ "event": "signup" | "signup_confirm" | "signin" | "signin_fail" | "mfa_setup" | "reset" | "signout" | "account_delete" | "rate_limited", "outcome", "sub"?, "request_id", "ts" }. Never an email, password, code, token, IP or imported text.

### Alarms (D-80, one SNS topic per stage)
| Alarm | Source | Threshold |
|---|---|---|
| sign-up spike | security events, signup | over 50 in 1 hour |
| sign-in failures | security events, signin_fail | over 100 in 15 minutes |
| threat protection blocks | pool risk metrics | over 10 in 15 minutes |
| WAF blocks and CAPTCHAs | web ACL metrics | over 500 in 5 minutes |
| web server errors | Amplify 5xx | over 2% for 10 minutes |
| API errors and throttles | HTTP API 5xx and 429 | over 2%, or any 429 for 5 minutes |
| function errors and throttles | Lambda | any for 5 minutes |
| email sender health | SES bounce and complaint rate | over 5% bounce or 0.1% complaint |
| cost | AWS Budgets (existing, data-architecture D-10) | 50%, 80%, 100% |
| rollup failures | on-failure queue (existing) | any message |

### Stage parameters (new)
| Name | Written by | Read by |
|---|---|---|
| /smart-finances/<stage>/web-acl-arn | WebEdgeStack | WebStack |
| /smart-finances/<stage>/web-origin | WebStack | DataStack (bucket browser rule) |
| /smart-finances/<stage>/api-url | ApiStack | WebStack (build setting) |
| /smart-finances/<stage>/web-client-id | DataStack | WebStack, ApiStack (audience) |

## Alternatives
<!-- Only for real technical forks. -->

### Fork: where the session lives (D-72)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. Encrypted cookie holding the tokens | no table; tokens over 4 KB need several cookies; cannot end a session from the server | a key in Secrets Manager | rejected |
| B. Opaque id in the cookie, tokens in a table | one table and one read per request; sessions can be listed and ended | sessions table | chosen |

### Fork: per-person and per-address limits (D-76)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. WAF on the API | not possible on an HTTP API (F-44) | none | rejected |
| B. Limits at the pool | every call comes from the web server, so all people share one address (F-47) | none | rejected |
| C. WAF at the web app's edge for addresses, counters in the sessions table for people and emails | two places to read | web ACL plus counters | chosen |

### Fork: sign-in flow (D-73)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. The Amplify adapter with managed pages | experimental, and its pages are not ours (F-37); ruled out by D-66 | none | rejected |
| B. SRP from the server with a public client | no threat protection context, no secret | none | rejected |
| C. Password flow from the server with a confidential client and context data | the password crosses our server, over TLS, and must never be logged | new client, secret | chosen |

## States and exits
| State | Entered when | Exits when | On failure or timeout |
|---|---|---|---|
| sign-up | the form is posted with accepted terms | the pool sends an email code: go to confirm | refused or existing email: the same "check your email" screen; disposable domain or limit: plain refusal |
| confirm | code screen | right code: consent recorded, then sign in | wrong code: try again; 5 wrong: wait; expired: send a new code |
| password | sign-in posted | the pool asks for setup, code or new password | wrong email or password: one message for both; locked or limited: try later |
| setup | first sign-in | a valid code from the new key: session created | wrong code: try again with the same key; the key is shown once per attempt and never logged |
| code | every later sign-in | a valid code: new session id, then the overview | wrong or expired code: try again; 5 wrong: start over |
| signed in | session created | sign out, idle 30 minutes, 12 hours, password change, delete account | refresh refused: session row deleted, sign-in with the path kept |
| reset | reset posted | a code sent if the email exists (same screen either way) | limit: try later |
| reset confirm | code and new password | password changed: every session ended, sign in again with the authenticator | wrong code or breached password: the reason in plain words |
| import upload and watch | file chosen | final status (done, unchanged, superseded, failed, expired, ignored) | stalled: repair; 15 minutes still running: say it continues |
| erasing | DELETE typed and pressed | 202 with counts | conflict: import running; timeout or 5xx: "may be unfinished", offer Finish erasing (repeats the call) |
| deleting account | delete confirmed with the typed word | data erased, pool user deleted, sessions removed: signed-out page with counts | a step fails: the screen says which part remains and offers to finish |

## Cross-cutting
- **Security and permissions:** OWASP ASVS 5.0 chapters V6 (authentication), V7 (session management), V3 (web frontend) and V14 (data protection) are the checklist, with the OWASP Authentication, Session Management and CSRF cheat sheets (D-75). The browser holds only the session cookie (AC-16). CSRF: SameSite=Lax plus an Origin check on every post. The person comes only from the session; the API checks the token's sub (AC-15). The sign-in pool, sessions table and secret are new trust boundaries in the threat model.
- **Personal data and logs:** security events carry no email, IP or token (Contracts). WAF logs keep IPs for 30 days, for abuse review only. Sessions expire by TTL. Fixtures and screenshots use data/synthetic only. Consent records live in the person's partition and go with delete account.
- **Performance and cost:** pages render on the server per request (nonces), with one sessions read and up to four API reads on the overview. New costs per stage: Cognito Plus per active person, WAF web ACL and rules plus requests, Amplify build minutes and compute, DynamoDB on demand, SES per email. Budgets alarm at 50, 80 and 100%.
- **Deploy and infrastructure:** CI deploys the edge, data, API, web and alarms stacks; Amplify builds the app on each push to its branch. A person creates the GitHub token, confirms the alarm email, verifies the SES domain and requests SES production access.
- **Observability:** the alarms table and one dashboard per stage; Amplify build status; the post-deploy health check.
- **Old clients:** none (D-2). The public SRP client stays until the web server signs in on qa, then a task removes it.
- **Release order:** one merge into qa (D-68). CI order: edge, data (pool changes, new client, trigger), API (audience lists both clients), web, alarms; Amplify then builds the branch. Sign-up opens on qa at once; staging and prod wait for Q-8 and for data PRs 2 and 3 (D-64).
- **Rollback:** revert the merge in qa. The pool stays (retained); sign-up can be turned off by one setting without losing accounts. Amplify can redeploy an earlier build from the console. Sessions in the table expire on their own.

## Risks
| RK | Risk | Likelihood | Impact | Mitigation or acceptance | Owner |
|---|---|---|---|---|---|
| RK-1 | The read and import routes are not merged, so screens are built against the contract alone. | high | high | types.ts is the one copy; fixture tests cover every screen; qa checks wait for the data PRs (D-64). | owner |
| RK-2 | Amplify builds on its own, so a branch could ship with failing tests or a failed build could go unnoticed. | medium | high | amplify.yml runs the tests before building; CI polls /api/health for the commit sha and fails on timeout. | owner |
| RK-3 | A missing or wrong content policy ships unnoticed. | low | high | The post-deploy check compares the headers with the contract; a browser test checks the nonce policy locally. | owner |
| RK-4 | The compute role gives the server no credentials (F-45), so the secret and sessions table cannot be read. | medium | high | A qa check in the first web task; any fallback is recorded as a new decision. | owner |
| RK-5 | Turning on sign-up, Plus or the new client replaces the pool and orphans the data. | low | high | A synth diff test asserts the pool's logical id and no replacement before merge. | owner |
| RK-6 | The password crosses the web server and could be logged. | low | high | A test that the logger refuses fields named password, code or token; a review of every auth handler (Judgment: high). | owner |
| RK-7 | Fake sign-ups run up cost or email reputation. | medium | medium | WAF challenge and CAPTCHA, the disposable-domain trigger, the sign-up spike and SES alarms. Accepted in D-67. | owner |
| RK-8 | Cognito's default sender caps emails per day before SES is ready. | high | medium | qa only uses the default sender; staging and prod need SES (D-77, a HUMAN step). | owner |
| RK-9 | The data service was built for one owner: alarms, sizing and the shared throttle (F-31). | high | medium | D-81 raises the throttle and adds per-person limits; the follow-up rows in the data-architecture spec cover the rest. | owner |
| RK-10 | Legal duties for strangers' data are unmet when sign-up opens. | medium | high | Q-8 blocks promotion to staging and prod (Default NONE). | legal |
| RK-11 | Chivo is wide, so Spanish wraps in tables, chips and the rail. | medium | low | Screenshots in Spanish at 400 and 1400 pixels, checked by a person (D-16, D-42). | owner |
