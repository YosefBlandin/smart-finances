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
A Next.js 15 app in apps/web, built and served by the Amplify app the owner created in the console (D-102), in us-east-1 like every other stack (D-89). CI deploys the stacks, then starts the Amplify build (D-93). The web server is the only thing the browser talks to apart from file uploads: it runs sign-up and sign-in with the sign-in service itself (D-66, D-73), keeps pre-auth and session state in server-side rows behind opaque cookies (D-72, D-91), and calls the data API with the person's access token (D-53, D-82). A firewall limits automated traffic (D-90); the pool blocks breached passwords (D-94); alarms watch the whole path (D-80).

```
browser ─https─▶ WAF (CloudFront scope) ─▶ Amplify: Next.js web server ──▶ sign-in pool (confidential client)
   │  __Host-pre / __Host-sid cookies only        │  sessions table, accounts table
   │                                              └─ Bearer access token ─▶ HTTP API ─▶ handlers
   └─ fetch FormData (presigned) ─────────────────────────────────────────▶ upload bucket
```

## Components
<!-- One subsection per component that changes. -->

### Web app (Next.js)
- Where: smart-finances:apps/web/package.json, apps/web/next.config.ts (new), apps/web/src/app/ (new), apps/web/src/middleware.ts (new), apps/web/amplify.yml (new).
- What: App Router with server components; routes in Contracts, "Web routes". The rail, top bar and account area follow D-24, D-35 to D-44; the Ask link and assistant screens are not built (D-46); the prototype-only nav group is not built (D-36). Month and view live in the address; free-text search does not (D-82).
- Middleware sets a fresh nonce and the content policy on every response (Contracts), loads the session for money routes and sends people without one to sign-in, sends a signed-in person away from auth routes to the overview, and refuses every request of an account marked deleting (D-97).
- 403 and 404 from the API both show one "not found" screen with a link to the overview. A kept path is resumed with a GET after sign-in, never by replaying a post; the sign-in screen says when the session ended for idle time.
- Switching language keeps the address; unsent form input is cleared (D-83).
- Accessibility: html lang follows the language; focus moves to the main heading after navigation; field errors use aria-describedby and the form message role=alert; import status goes to a polite live region; reduced motion is honoured (AC-10).
- Serves: AC-4, AC-8, AC-10, AC-16; D-24, D-35 to D-46, D-71, D-82, D-83, D-101.

### Design tokens and parts
- Where: apps/web/src/styles/tokens.css (new), apps/web/src/styles/base.css (new), apps/web/src/ui/ (new).
- What: the prototype's custom properties copied as they are, light and dark, theme from the system setting; parts use only tokens, through CSS modules (D-57). Fonts through next/font from local files (D-58); Tabler outline icons at 2px (D-17). Red: the bad money figure (AC-11) and error notes or failed statuses (D-63), never a second money figure.
- The prototype is extended first with every auth and account screen and its states (D-100).
- Serves: AC-10, AC-11; D-12, D-13, D-15 to D-17, D-21, D-22, D-25, D-27, D-32 to D-34, D-57, D-58, D-63, D-100.

### Words and formats
- Where: apps/web/src/i18n/en.ts (new), apps/web/src/i18n/es.ts (new), apps/web/src/i18n/format.ts (new).
- What: one catalogue per language with the same keys and none, one and many forms (D-19); amounts per D-23 and D-30; every error code and auth outcome maps to a sentence. Language from the lang cookie, else Accept-Language (D-83). Skipped-row reasons per D-86. /privacy and /terms exist in both languages under one version id. Sign-up and reset emails go out in the person's language through the pool's custom message trigger, which reads the language the web server passes as client metadata.
- Serves: AC-4, AC-5, AC-8, AC-14; D-10, D-11, D-19, D-23, D-30, D-42, D-83, D-86.

### Auth flows (web server)
- Where: apps/web/src/server/auth/ (new): signUp.ts, confirm.ts, signIn.ts, challenges.ts, reset.ts, signOut.ts, deleteAccount.ts, preauth.ts; apps/web/src/app/(auth)/ (new) screens.
- Calls the pool with the confidential client (secret hash) and the person's IP as context data (D-73, D-94). The IP is the right-most X-Forwarded-For entry added by Amplify's CDN, never the left-most; a qa check confirms the header.
- Between steps the state lives in the pre-auth row (D-91); a completed sign-in deletes it and issues a new __Host-sid.
- At the first completed sign-in the consent from the pre-auth row is written to the accounts table before any money screen (D-87); a person without a consent row sees the consent screen.
- Every auth post is a route handler that checks the Origin, then the window counters (D-90); a WAF 429 or a counter refusal shows the "too many tries" message with the wait.
- Sign-up, reset and sign-in give the same message and timing for known and unknown emails. An existing unconfirmed email gets a new code and the confirm screen (D-99).
- After a reset: global sign-out and session rows removed (D-92). Delete account: D-97, after a fresh authenticator code.
- Logs: one security event per outcome (Contracts); the logger refuses fields named password, code, secret or token.
- Serves: AC-1, AC-12, AC-13, AC-14, AC-17, AC-18, AC-19, AC-20; D-66, D-73, D-75, D-87, D-90 to D-92, D-94, D-97, D-99, D-103.

### Sessions and accounts
- Where: apps/web/src/server/session.ts (new), apps/web/src/server/accounts.ts (new); tables in smart-finances:infra/lib/web-stack.ts#WebStack (new).
- Sessions: D-72. The key is the SHA-256 of the cookie id, so a table read cannot be replayed as a cookie. Every read checks expires_at and last_seen_at itself; the TTL only cleans up. Refresh on the server when the access token has under 5 minutes left. Sign out removes the row and revokes the refresh token.
- Accounts: one row per person with consent, status (active or deleting) and the per-person caps (D-87, D-96, D-97).
- Serves: AC-14, AC-15, AC-16, AC-17, AC-18; D-72, D-87, D-91, D-96, D-97.

### Data access (web server)
- Where: apps/web/src/server/api.ts (new), apps/web/src/server/types.ts (new), apps/web/src/app/(app)/ (new) screens and route handlers.
- Reads: server components call api.ts, which adds the access token, times out at 5 seconds (D-101), keys errors on HTTP status (401: one refresh, then signed out; 403 and 404: not found; 409, 429 and 5xx: failed state with retry; bodies without the F-3 shape accepted) and counts the request against the person's limit. types.ts mirrors the data-architecture spec's HTTP routes and is the web's single copy (D-82).
- Changes (review choice, rate, erase, delete account, import request) are route handlers that check the session, the Origin and the limit; the button is busy while the request runs; the page re-renders from the server afterwards.
- Imports: the route handler checks the caps and the pause switch (D-96), asks POST /imports, and returns the presigned form; the browser sends the file with fetch and FormData; the page polls the import through the server.
- Serves: AC-5, AC-6, AC-7, AC-9, AC-15, AC-17; D-53, D-82, D-96, D-101.

### Screens
- Where: apps/web/src/app/(app)/overview, transactions, review, imports, rates, data (new).
- Overview: totals and rates for the month and up to six before it; kept, typical month (D-20, D-85) and the bad-month case (D-26 to D-31); the waiting line; SVG charts with a table alternative (D-57); net worth hidden (D-18). Each section fails alone (D-101).
- Transactions: every filter, sort and page is a request (AC-6). Review: category or approve for payments-report rows; other sources show the fix-in-source note (F-11). Imports: source, name check, upload, status, skipped rows (AC-5).
- Your data: export; "Erase my data" with the typed word DELETE, the 35-day note and counts (AC-7); "Delete my account" with a fresh authenticator code, its own warning (data, sign-in and consent removed; backups kept 35 days) and a signed-out result with counts (AC-18).
- Imported text renders only as text nodes; no raw HTML insertion, no markdown renderer (AC-9; its assistant half moves to Epic 4 with D-46).
- Serves: AC-2, AC-5 to AC-9, AC-11, AC-18; D-18 to D-21, D-23, D-26 to D-31, D-34, D-85, D-97, D-101.

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
- What: self sign-up on; Plus plan with threat protection per D-94; password policy per Contracts; a new confidential web-server client (secret, password flow, refresh, additional context data; access token 60 minutes, refresh token 12 hours, challenge session 15 minutes); its secret copied into a Secrets Manager secret in this stack, whose ARN (never the value) is a stage parameter. Pre-sign-up trigger per D-98; custom message trigger for the email language. Email through SES once the owner's domain exists (D-77).
- The public SRP client stays only until the web server signs in on qa, and goes before any stage opens sign-up (D-98). Meanwhile the API's audience lists both clients (smart-finances:infra/lib/api-stack.ts#ApiStack).
- Stays the same: the pool itself (not replaced; a synth test checks), email sign-in, TOTP required, email-only recovery.
- Serves: AC-12, AC-13, AC-19, AC-20; D-73, D-77, D-94, D-98.

### Data service changes
- Where: smart-finances:infra/lib/api-stack.ts#ApiStack, smart-finances:infra/lib/data-stack.ts#DataStack.
- What: stage throttle 50 per second, burst 100; no API browser rule; the data stack stops managing the bucket's browser rule (D-88). Reserved concurrency for the read handler and a cap for the parser once the quota is raised (D-95). Quotas, sizing and owner-only alarms go to the data-architecture spec as follow-ups (D-81).
- Serves: AC-15, AC-17; D-81, D-88, D-95.

### Shared field and category lists
- Where: smart-finances:apps/api/src/ingest/fields.mjs (new) with FIELDS and KINDS, re-exported by smart-finances:apps/api/src/ingest/schema.mjs#FIELDS; smart-finances:apps/api/src/ingest/categories.mjs#CATEGORIES (new) beside smart-finances:apps/api/src/ingest/categories.mjs#categoryFor; an exports map in smart-finances:apps/api/package.json for these two files.
- Why: the schema module loads the server's hashing module (F-13); the review screen needs the category list.
- Serves: AC-6; D-82.

### Web stack
- Where: smart-finances:infra/lib/web-stack.ts#WebStack (new), smart-finances:infra/lib/stage.ts#addStage, smart-finances:infra/lib/stage-values.ts#readStageValues.
- Adopts the Amplify app by the amplify-app-id stage parameter (D-102). Custom resources set the app's platform to web compute and its service and compute roles, set the branch's auto-build off and its compute role, and put the upload bucket's browser rule with the branch address (D-88, D-93).
- Owns: the CloudFront-scoped web ACL and its association with the app (D-89, D-90), the WAF log group (30 days), the Amplify log group /aws/amplify/<app id> (one month), the Amplify service role (write to that log group only), the compute role, the sessions and accounts tables, and the hourly housekeeping function (D-99).
- The compute role may: read the client secret and the stage parameters; read and write both tables; admin get, delete and global sign-out users on this pool only (D-92, D-97).
- Serves: AC-15 to AC-19; D-72, D-87 to D-93, D-97 to D-99, D-102.

### Alarms
- Where: smart-finances:infra/lib/alarms-stack.ts#AlarmsStack (new); apps/web/src/server/log.ts (new).
- What: one SNS topic per stage with the owner's email, the alarms in Contracts, one dashboard (D-80). Metric filters on /aws/amplify/<app id>; a heartbeat (at least one health line an hour) treats missing data as breaching, so a silent log pipe alarms.
- Serves: AC-17, AC-19; D-80.

### CI and build
- Where: smart-finances:.github/workflows/deploy.yml, smart-finances:infra/lib/github-oidc-stack.ts, apps/web/amplify.yml (new).
- deploy.yml: web unit and browser tests before credentials; deploy data, API, web and alarms; then start the Amplify job for the commit and poll /api/health until it reports that sha, then check the headers against the contract (D-93, RK-2, RK-3).
- The OIDC role gains Amplify start-job and get-job on this app only. amplify.yml runs the web unit tests before the build.
- Serves: D-59, D-93.

### Docs
- docs/adr/0004-web-framework-and-host.md (new): D-62, D-65, D-89, D-93, D-102. docs/adr/0005-sessions-and-sign-up.md (new): D-72, D-73, D-87, D-90 to D-94, D-97, D-98.
- smart-finances:docs/threat-model.md: open sign-up, the web server, the sessions and accounts tables and the secret as trust boundaries; B1 updated; "single user" leaves the out-of-scope list.
- README.md, "Layout" and "Status"; the data-architecture spec's decisions get the follow-up rows for D-81 and D-95.

## Contracts
<!-- The single home for every interface that crosses a boundary. -->

### Data API
The routes, shapes, error codes and paging are the data-architecture spec's: docs/specs/data-architecture/architecture.md, Contracts, "HTTP routes". This spec adds none. The web server sends authorization: Bearer <access token>; the API's audience check takes the web-server client id, which the access token carries as client_id (D-53).

### Web routes
| Path | Who | Purpose |
|---|---|---|
| /sign-up, /sign-up/confirm, /sign-in, /sign-in/code, /sign-in/setup, /reset, /reset/confirm, /lost-authenticator | signed out | auth screens (D-66, D-103) |
| /consent | signed in, no consent row | accept the current versions (D-87) |
| /privacy, /terms | anyone | both languages, one version id each |
| /overview, /transactions, /review, /imports, /rates, /data | signed in with consent | money screens |
| /api/auth/* | route handlers | auth posts, Origin-checked |
| /api/health | anyone | { sha, stage } for the deploy check and the heartbeat |

Search values: month (yyyy-mm), view (native or usd), kind, category, sort. Free text stays in the form (D-82).

### Cookies
- __Host-sid: 32 random bytes, base64url; Secure; HttpOnly; SameSite=Lax; Path=/; no Max-Age.
- __Host-pre: 32 random bytes; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age 900; deleted when sign-in completes.
- lang: en or es; SameSite=Lax; one year.
Nothing else is written to browser storage.

### Sessions table (DynamoDB, on demand, TTL on expires_at)
| Item | Key | Fields |
|---|---|---|
| session | pk SID#<sha256 of id> | sub, access_token, id_token, refresh_token, created_at, last_seen_at, expires_at (+12 h) |
| pre-auth | pk PRE#<sha256 of id> | step, email_hash, challenge_session, totp_secret?, accepted_versions, lang, attempts, expires_at (+15 min) |
| counter | pk RL#<scope>#<value>#<window start> | n, expires_at (window end + 1 min) |
| GSI | sub | every session of a person |
Idle 30 minutes; absolute 12 hours; a new id at every sign-in.

### Accounts table (DynamoDB, on demand, no TTL)
pk ACCT#<sub>: consent { terms_version, privacy_version, lang, accepted_at }, status (active or deleting), deleting_since?, imports_today { day, n }, stored_bytes. Erase-all resets stored_bytes and keeps the row; delete account removes it last.

### Limits (D-90, D-96)
| Scope | Limit | Where | On excess |
|---|---|---|---|
| requests per IP, excluding /_next/static | 1,000 per 5 minutes | WAF rate rule | block 429 |
| GET of auth pages | every request | WAF challenge, token 30 minutes | silent browser check |
| auth posts per IP | 20 per 5 minutes | WAF rate rule | block with custom 429 body |
| sign-in or reset failures per email and address prefix | 5 per 15-minute window | counter | same message, wait shown |
| data requests per person | 120 per 1-minute window | counter | 429 page (AC-17) |
| imports per person | 10 a day, 200 MiB stored, 1 running | accounts table | plain refusal |
| all imports | pause switch | stage parameter | plain refusal |
| sign-up email | web-server client only; not disposable; qa allow-list until Q-8 | pre-sign-up trigger | plain refusal (AC-19) |

### Password and code rules (D-75, D-94)
Length 12 to 128, any characters, no composition rules or expiry; breached passwords blocked from launch; TOTP required at first sign-in; the email code expires in 24 hours and the reset code in 1 hour; 5 wrong codes lock the step.

### Response headers (middleware, every response)
- Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-<n>' 'strict-dynamic'; style-src 'self' 'nonce-<n>'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://<upload bucket host>; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'.
- Strict-Transport-Security max-age=31536000; X-Content-Type-Options nosniff; Referrer-Policy no-referrer; Permissions-Policy camera=(), microphone=(), geolocation=(); Cache-Control no-store on signed-in pages.
- Amplify custom headers set no content policy.

### Security events (web server log, one JSON line each)
{ "event": "signup" | "signup_confirm" | "signin" | "signin_fail" | "mfa_setup" | "reset" | "signout" | "account_delete" | "rate_limited" | "health", "outcome", "sub"?, "request_id", "ts" }. Never an email, password, code, token, IP or imported text.

### Alarms (D-80, one SNS topic per stage)
| Alarm | Source | Threshold |
|---|---|---|
| sign-up spike | security events, signup | over 50 in 1 hour |
| sign-in failures | security events, signin_fail | over 100 in 15 minutes |
| threat protection blocks | pool risk metrics | over 10 in 15 minutes |
| WAF blocks | web ACL metrics | over 500 in 5 minutes |
| web server errors | Amplify 5xx | over 2% for 10 minutes |
| API errors and throttles | HTTP API 5xx and 429 | over 2%, or any 429 for 5 minutes |
| function errors and throttles | Lambda, including housekeeping | any for 5 minutes |
| log heartbeat | security events, health | missing for 1 hour (missing data breaches) |
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
| signup-allowlist | a person (qa only) | pre-sign-up trigger (D-98) |
| imports-paused | a person, in an emergency | web server (D-96) |

## Alternatives
<!-- Only for real technical forks. -->

### Fork: where the session lives (D-72)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. Encrypted cookie holding the tokens | tokens over 4 KB need several cookies; a session cannot be ended from the server | a key in Secrets Manager | rejected |
| B. Opaque id in the cookie, tokens in a table | one read per request; sessions can be listed and ended | sessions table | chosen |

### Fork: per-person and per-address limits (D-90)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. WAF on the API | not possible on an HTTP API (F-44) | none | rejected |
| B. Limits at the pool | every call comes from the web server, so all people share its addresses (F-47) | none | rejected |
| C. WAF at the app's edge for addresses, window counters for people and emails | two places to read | web ACL plus counters | chosen |

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
| sign-up | form posted with accepted terms | code sent: confirm | existing confirmed email: same screen; unconfirmed: code resent (D-99); refused or limited: plain message |
| confirm | code screen | right code: sign in | wrong: try again; 5 wrong: wait; expired: send a new code; never confirmed: removed after 24 hours |
| password | sign-in posted | setup or code challenge | wrong email or password: one message; unconfirmed: code resent, confirm screen; limited: wait |
| setup | first sign-in | valid code from the new key: consent, then session | wrong code: same key; challenge expired after 15 minutes: back to password, remove the old entry in the app |
| code | later sign-ins | valid code: new session id, overview | wrong: try again; 5 wrong or expired: back to password; lost: lost-authenticator page |
| consent | no consent row | accepted: overview | refused: signed out |
| signed in | session created | sign out, idle 30 minutes, 12 hours, reset, delete | refresh refused or row expired: signed out, path kept |
| reset | posted | code sent if the email exists (same screen) | limited: wait |
| reset confirm | code and new password | changed: everywhere signed out (D-92), sign in again | wrong code or breached password: the reason |
| import | file chosen | final status | stalled: repair; still running after 15 minutes: say it continues |
| erasing | DELETE typed and pressed | 202 with counts | import running: refused; timeout or 5xx: may be unfinished, Finish erasing repeats it |
| deleting account | fresh code and confirm | each D-97 step done: signed-out page with counts | a step fails: deleting status stays; the person or the hourly job finishes it |

## Cross-cutting
- **Security and permissions:** OWASP ASVS 5.0 V6, V7, V3 and V14 and the OWASP Authentication, Session Management and CSRF cheat sheets are the checklist (D-75). The browser holds only opaque cookies (AC-16). CSRF: SameSite plus an Origin check on every post. The person comes only from the session; the API checks the token's sub (AC-15). Admin rights on the pool are limited to get, delete and global sign-out for the compute role and the housekeeping function.
- **Personal data and logs:** security events carry no email, IP or token. WAF logs keep IPs 30 days, for abuse review. Amplify logs one month. Pre-auth rows hold an email hash, never the email. Fixtures and screenshots use data/synthetic only.
- **Performance and cost:** pages render per request (nonces, no streaming, D-101): one session read and up to four API reads on the overview. New costs per stage: Cognito Plus per active person, WAF rules and requests, Amplify builds and compute, two on-demand tables, SES per email, one hourly function. Budgets alarm at 50, 80 and 100%.
- **Deploy and infrastructure:** release.md, "Rollout order" and "HUMAN needs".
- **Observability:** the alarms table, the heartbeat, one dashboard per stage, and the post-deploy health check.
- **Old clients:** none (D-2). The public SRP client goes before any stage opens sign-up (D-98).
- **Release order and rollback:** release.md.

## Risks
| RK | Risk | Likelihood | Impact | Mitigation or acceptance | Owner |
|---|---|---|---|---|---|
| RK-1 | The read and import routes are not merged, so screens are built against the contract alone. | high | high | types.ts is the one copy; fixture tests cover every screen; qa checks wait for the data PRs (D-64). | owner |
| RK-2 | An Amplify build fails or serves an old commit unnoticed. | medium | high | CI starts the job and polls /api/health for the sha (D-93); amplify.yml runs tests first. | owner |
| RK-3 | A missing or wrong content policy ships unnoticed. | low | high | The post-deploy check compares headers with the contract; a browser test checks the nonce policy locally. | owner |
| RK-4 | The compute role gives the server no credentials (F-45). | medium | high | A qa check in the first web task; any fallback becomes a new decision. | owner |
| RK-5 | A pool change replaces the pool and orphans the data. | low | high | A synth test asserts the pool's logical id and no replacement. | owner |
| RK-6 | The password crosses the web server and could be logged. | low | high | A logger test that refuses secret field names; a fresh review of every auth handler. | owner |
| RK-7 | Fake sign-ups run up cost or email reputation. | medium | medium | D-90, D-96, D-98 and the sign-up and SES alarms; accepted in D-67. | owner |
| RK-8 | Cognito's default sender caps emails per day before SES is ready. | high | medium | Only qa uses it, behind the allow-list (D-77, D-98). | owner |
| RK-9 | The data service was built for one owner (F-31). | high | medium | D-81, D-95, D-96 and the follow-up rows in the data-architecture spec. | owner |
| RK-10 | Legal duties are unmet when sign-up opens. | medium | high | Q-8 gates every stage's public sign-up (D-98). | legal |
| RK-11 | Chivo is wide, so Spanish wraps in tables, chips and the rail. | medium | low | Screenshots in Spanish at 400 and 1400 pixels, checked by a person. | owner |
| RK-12 | A few heavy imports use the account's Lambda concurrency and every read fails. | medium | high | The quota raise and reservations (D-95) before sign-up opens; a load check on qa. | owner |
| RK-13 | The log pipe breaks and the security alarms go silent. | low | medium | The heartbeat alarm treats missing data as breaching. | owner |
