---
spec: web-ui
ticket: none
tier: M
status: draft
---
# Web UI: design system and screens: architecture

<!-- Design by component. Cite code as <repo>:<path>#<Symbol>, never with line numbers; the drift script checks these refs. Add (new) after a file or symbol that a task creates. Cite ACs and decisions by id and never restate them. Executors read only the sections their tasks cite, so each section must stand on its own. Examples sit in these comments. -->

## Overview
<!-- 3 to 6 lines: the shape of the change and the data flow. Add a small diagram only if it saves words. -->
A new single-page app in apps/web, built to static files and served by Amplify Hosting (D-45, D-49, D-50). The browser signs in to the stage's user pool, keeps the session only for the tab (D-47), and calls the data API directly with the access token (D-53). Nothing renders on a server. Each stage's web stack writes a small runtime config file into the bundle, so one build serves every stage (D-51). The API and the upload bucket allow exactly that stage's web address (D-1). Screens follow the prototype and its tokens (D-4); a demo mode runs the same screens on bundled synthetic data with no sign-in (D-56).

```
browser ──SRP──▶ user pool (tokens kept in the tab only)
   │  GET /config.json        (from the bundle, per stage)
   │  Bearer access token ──▶ HTTP API ──▶ handlers (data-architecture spec)
   └─ form POST (presigned) ─▶ upload bucket
```

## Components
<!-- One subsection per component that changes: what changes, where (<repo>:<path>#<Symbol>), which ACs and decisions it serves, and what stays the same. -->

### Web app shell
- Where: smart-finances:apps/web/package.json, apps/web/index.html (new), apps/web/vite.config.ts (new), apps/web/src/main.tsx (new), apps/web/src/app/routes.tsx (new).
- What: Vite, React and TypeScript, with client routes for sign-in, overview, transactions, to review, imports, dollar rates and your data (D-49, D-55). The rail, the top bar under 960px and the account area follow D-24, D-35 to D-44. The Ask link and the assistant screens are not built (D-46). The prototype-only nav group is not built (D-36).
- Month and amounts view live in the address as search values, so a reload or a language change keeps the screen (AC-4).
- Serves: AC-4, AC-8, AC-10; D-24, D-35 to D-44, D-46, D-49, D-55.

### Design tokens and parts
- Where: apps/web/src/styles/tokens.css (new), apps/web/src/styles/base.css (new), apps/web/src/ui/ (new).
- What: the prototype's custom properties copied as they are, light and dark; theme follows the system setting. Parts (button, field, chip, flag, note, table, state block, colour field, kept bar, band strip, category square) use only these tokens (D-16, D-22, D-25, D-27, D-32 to D-34, D-57). Fonts are bundled files, not a font service (D-58). Icons are Tabler outline at 2px (D-17).
- Stays the same: the prototype remains the design reference; a hand-off that changes a token changes tokens.css first.
- Serves: AC-3, AC-10; D-12, D-13, D-15 to D-17, D-21, D-22, D-25, D-27, D-32 to D-34, D-57, D-58.

### Words and formats
- Where: apps/web/src/i18n/en.ts (new), apps/web/src/i18n/es.ts (new), apps/web/src/i18n/format.ts (new).
- What: one catalogue per language with the same keys; plural forms for none, one and many (D-19). The language choice is kept in local storage as a preference only (D-55). Amounts follow D-23 and D-30 through one formatter built on the browser's number formatting; error codes map to plain sentences.
- Serves: AC-4, AC-8; D-10, D-11, D-19, D-23, D-30, D-42, D-55.

### Session
- Where: apps/web/src/auth/session.ts (new), apps/web/src/auth/SignIn.tsx (new).
- What: the Amplify JavaScript library's sign-in category only, with token storage set to session storage (D-47, D-52). Steps: email and password, then a new password and authenticator setup on the first sign-in, then the 6-digit code (see States and exits). Sign out clears the tab's storage and the query cache.
- Serves: AC-1; D-47, D-52, D-53.

### Data client
- Where: apps/web/src/api/client.ts (new), apps/web/src/api/types.ts (new), apps/web/src/api/fixtures.ts (new).
- What: one fetch wrapper adds the access token, parses the error shape (F-3) and retries once after a token refresh on unauthorized. TanStack Query caches reads and pages by cursor (D-54). types.ts mirrors the data-architecture spec's HTTP routes; it is the web's single copy. fixtures.ts answers the same calls from the bundled synthetic data, for demo mode, local work and browser tests (D-56).
- The person id is never sent (F-4). Imported text is passed to the screens as plain strings (AC-9).
- Serves: AC-5, AC-6, AC-7, AC-9; D-53, D-54, D-56.

### Screens
- Where: apps/web/src/screens/ (new): Overview, Transactions, Review, Imports, Rates, YourData.
- Overview: reads totals and rates for the month and the six before it, works out kept, typical month and the bad-month case on the client (D-18 to D-21, D-26 to D-31), and the waiting line from review and imports. Charts are drawn by hand with a table alternative (D-57). Net worth stays hidden (D-18).
- Transactions: every filter, sort and page is a request; the screen keeps no list of its own beyond the pages returned (AC-6).
- Review: category choice and approve for payments-report rows; other sources show the fix-in-source note (F-11).
- Imports: source choice, file name check before upload, presigned form post, then status until a final status (States and exits); skipped rows listed with reasons (AC-5).
- Your data: export download, and erase-all with the typed word, the 35-day note and the counts (AC-7, F-12).
- Every screen has loading, empty, failed and partial states with a next step (AC-8).
- Imported text (place, original text, file names) renders as text nodes only; no screen uses raw HTML insertion (AC-9).
- Serves: AC-2, AC-3, AC-5 to AC-9; D-13, D-18 to D-21, D-23, D-26 to D-31, D-34.

### Shared field and category lists
- Where: smart-finances:apps/api/src/ingest/fields.mjs (new) holds FIELDS and KINDS, which smart-finances:apps/api/src/ingest/schema.mjs#FIELDS re-exports; smart-finances:apps/api/src/ingest/categories.mjs#CATEGORIES (new) lists the rule categories plus Uncategorized, next to smart-finances:apps/api/src/ingest/categories.mjs#categoryFor. smart-finances:apps/api/package.json gains an exports map for these two files only.
- Why: the schema module loads the server's hashing module, so a browser bundle cannot import it (F-13).
- Stays the same: every API import keeps working; schema.mjs keeps its exports.
- Serves: AC-6; D-54.

### Web stacks
- Where: smart-finances:infra/lib/web-host-stack.ts#WebHostStack (new), smart-finances:infra/lib/web-stack.ts#WebStack (new), smart-finances:infra/lib/stage.ts#addStage.
- WebHostStack, deployed first: the Amplify app and one branch for the stage, with no Git connection, the security headers in Contracts, and the web address published as a stage parameter (D-50).
- WebStack, deployed last: a build bucket, the built files plus config.json uploaded to it, and one custom resource that starts an Amplify deployment from that prefix (D-50, D-51). Its role may start deployments on this app only.
- addStage: the data and API stacks add the published web address to the cdk.json origins for qa, staging and prod, read with smart-finances:infra/lib/stage-values.ts#readStageValues. Dev keeps localhost only. The API stack publishes its URL as a stage parameter.
- Serves: AC-1; D-1, D-45, D-50, D-51.

### CI
- Where: smart-finances:.github/workflows/deploy.yml.
- What: before credentials, build the web app and run its unit and browser tests. Deploy order: web host, data, API, web. After the web deploy, fetch the stage's config.json and fail the job if its stage does not match (RK-2).
- Serves: D-50, D-59.

### Docs
- docs/adr/0004-web-framework-and-host.md (new): records D-49 and D-45 (rule: docs/adr/README.md).
- smart-finances:docs/threat-model.md: adds the browser and web host as a trust boundary, the tab-only session and the content policy (rule: the profile's "Rules to honour").
- README.md, "Layout": apps/web becomes the Vite app, not Next.js. vercel.json stays as it is: the Vercel project is not used (D-45).

## Contracts
<!-- The single home for every interface that crosses a boundary: endpoints, request and response shapes, events, stored row shapes, error codes. Briefs link here; they never copy a contract. -->

### Data API
The routes, shapes, error codes and paging are the data-architecture spec's: docs/specs/data-architecture/architecture.md, Contracts, "HTTP routes". This spec adds no route. Every call sends authorization: Bearer <access token>; the API's token check takes the app client id as its audience, which an access token carries as client_id (D-53).

### Runtime config (/config.json, written by WebStack)
```
{ "stage": "qa", "region": "<aws region>", "apiUrl": "https://<id>.execute-api.<region>.amazonaws.com",
  "userPoolId": "<pool id>", "userPoolClientId": "<client id>" }
```
- Fetched once at start, with no cache. A missing or bad file shows the failed state and starts no sign-in.
- Local work uses apps/web/public/config.json (new), pointing at a stage or at demo mode.

### Stage parameters (new)
| Name | Written by | Read by |
|---|---|---|
| /smart-finances/<stage>/web-origin | WebHostStack | DataStack (upload bucket CORS), ApiStack (CORS) |
| /smart-finances/<stage>/api-url | ApiStack | WebStack (config.json) |

### Response headers (Amplify custom headers, every path)
- Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' <apiUrl> https://cognito-idp.<region>.amazonaws.com https://<upload bucket host>; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'.
- Strict-Transport-Security: max-age=31536000; X-Content-Type-Options: nosniff; Referrer-Policy: no-referrer; Permissions-Policy: camera=(), microphone=(), geolocation=().
- index.html and config.json: Cache-Control no-cache. Hashed assets: one year, immutable.

### Browser storage
| Store | Key | Holds | Cleared |
|---|---|---|---|
| session storage | the Amplify library's keys | the stage's tokens (D-47) | tab close or sign out |
| local storage | cuenta.lang | en or es (D-55) | never; it is a preference |
No money data, chat or file is written to any browser store (no-go).

### Web routes
/sign-in, /overview (the start after sign-in), /transactions, /review, /imports, /rates, /data. Demo mode serves the same screens under /demo/ (D-56). Search values: month (yyyy-mm), view (native or usd), and the transaction filters.

## Alternatives
<!-- Only for real technical forks, one table per fork under its own heading. -->

### Fork: app framework (D-49)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. Next.js with a static export (plan and README) | its app router writes inline scripts, so the content policy needs unsafe-inline or per-build hashes; the server features go unused | export config; Amplify serves files | rejected |
| B. Next.js served with server rendering on Amplify | a server that holds no data, a bigger attack surface and cost; the tokens still live in the browser | Amplify compute | rejected |
| C. Vite and React, a single-page app | the README and plan wording change; routing is a library, not files | one config file; Amplify serves files | chosen |

### Fork: styling (D-57)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. Tailwind with shadcn parts (plan) | the tokens would be copied into a second format; shadcn parts restyled to drop shadows, fills and boxes the brand rules out | two config files and a generator | rejected |
| B. The prototype's CSS custom properties with CSS modules | parts are written by hand; the calm-ui audit runs on the same CSS | one tokens file | chosen |

### Fork: deploy path to Amplify (D-50)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. Amplify connected to the GitHub repo | a second build system and a GitHub connection a person sets up; builds per push outside CI | Amplify build spec | rejected |
| B. CI calls the Amplify deploy API | the CI role may only assume the CDK roles, so it needs new rights | new role policy | rejected |
| C. A CDK stack uploads the build and starts the Amplify deployment | one custom resource; the deployment runs after the stack finishes, so CI checks the site (RK-2) | WebStack | chosen |

## States and exits
<!-- For anything with a lifecycle: each state, how it starts, how it ends, and what happens on failure or timeout. -->
| State | Entered when | Exits when | On failure or timeout |
|---|---|---|---|
| signed out | first visit, tab closed, sign out, renewal refused | the password step succeeds | wrong email or password: one plain sentence, fields kept |
| new password | first sign-in only, the pool asks for it | a valid password is saved | pool rule failed: the rule shown in plain words |
| authenticator setup | first sign-in only, the pool asks for it | a valid code from the new key | wrong code: try again; the key stays shown |
| code | every sign-in after the password | a valid 6-digit code: open the overview (AC-1) | wrong or expired code: try again; after 3 the pool may lock, shown in plain words |
| signed in | code accepted | sign out, tab closed, renewal refused | unauthorized on a call: one refresh and retry, then signed out with the screen kept in the address |
| import: requesting | a valid file and source chosen | the upload form arrives | bad_request or too_large: the reason, nothing uploaded |
| import: uploading | form received | storage answers | network failure or 15 minutes pass: the import will read expired; offer to start again |
| import: watching | upload accepted | a final status (done, unchanged, superseded, failed, expired, ignored) | status stalled: show Repair; after 15 minutes still running: say it continues and the list shows the result |
| erasing | the typed word matches and erase is pressed | 202 with counts (AC-7) | conflict while an import runs: say so; other errors: nothing erased message |
| after erase | 202 received | 65 minutes pass | imports and totals answer conflict; the screens say when they reopen |

## Cross-cutting
<!-- One short paragraph, or "none", for each. M tier: release order and rollback go here. -->
- **Security and permissions:** the browser holds only the tab's tokens (D-47). A strict content policy blocks inline and third-party scripts and limits calls to the API, the pool and the bucket (Contracts). Imported text and file names are untrusted (F-20, F-21) and render as text only (AC-9). Demo mode never holds tokens and calls nothing.
- **Personal data and logs:** the app writes no logs and has no analytics. Fixtures, tests and screenshots use data/synthetic only. Error screens show codes, never imported text.
- **Performance and cost:** static files behind Amplify's CDN; an overview loads with at most four reads (totals, rates, review, imports) plus transaction pages for the top places. The API throttle (10 per second, burst 20) is enough for one person; reads are cached for 30 seconds.
- **Deploy and infrastructure:** two new stacks per stage, two new stage parameters, and new origins in the data and API stacks (Components, Web stacks).
- **Observability:** the CI check of config.json after each deploy; Amplify's deployment status in the console for a person.
- **Old clients:** none. The Angular app on main is retired (D-2).
- **Release order:** one merge into qa ships everything (appetite). CI order is web host, data, API, web. Between the API deploy and the web deploy the old bundle (none on first release) may fail calls; accepted by the appetite.
- **Rollback:** revert the merge in qa. CI redeploys the stacks; the previous Amplify deployment can be redeployed from the console by a person. Removing the origin from CORS only stops the browser app.

## Risks
<!-- Mitigation names a test, a check, or the decision that accepts the risk. -->
| RK | Risk | Likelihood | Impact | Mitigation or acceptance | Owner |
|---|---|---|---|---|---|
| RK-1 | The read and import routes are not merged yet, so the app is built against the contract alone and may not match. | high | high | types.ts is the one copy of the contract, and the fixture tests run every screen on it; a person runs the qa checks once the data PRs merge. | owner |
| RK-2 | The Amplify deployment starts after the stack ends, so a failed deployment would not fail CI. | medium | medium | A CI step fetches the stage's config.json after deploy and fails on a missing file or a wrong stage. | owner |
| RK-3 | A script that slips into the page could read the tab's tokens. | low | high | Accepted in D-47; the content policy and AC-9 shrink the chance; a browser test checks the policy header is present. | owner |
| RK-4 | The first sign-in steps or the token the API accepts differ from what the design assumes. | medium | medium | A person walks one first sign-in on qa before the session task closes (HUMAN need). | owner |
| RK-5 | On the first deploy of a stage, the data and API stacks read a web address that does not exist yet. | medium | low | Web host deploys first; a synth test checks the API's allowed list holds the published address. | owner |
| RK-6 | Chivo is wide, so Spanish labels wrap in tables, chips and the rail. | medium | low | Browser screenshots in Spanish at 400 and 1400 pixels, checked by a person against D-16 and D-42. | owner |
| RK-7 | Demo mode could show real data or reach the API. | low | high | Fixtures come only from data/synthetic; a browser test in demo mode fails on any network call outside the site. | owner |

## Facts
<!-- M tier only: the research facts design uses. L keeps facts in research.md, so delete this section. One fact per row; evidence is <repo>:<path>#<Symbol>, never line numbers. Give a row an F id only when another file cites it; otherwise put - in the first cell. Example row: | F-1 | write path | Every signed-in call writes one event after the response. | api:src/events/log.ts#writeEvent | -->
| F | Area | Fact | Evidence |
|---|---|---|---|
| F-1 | api | At the pin, the API has one public route, GET /health, and a token check bound to the stage's pool and web client, ready for the data routes. Cross-origin rules come from the web origins list. | smart-finances:infra/lib/api-stack.ts#ApiStack |
| F-2 | api | The data routes, request and response shapes, error codes and paging are fixed in the data-architecture spec, Contracts, "HTTP routes": 15 routes. Its PR 1 (store, auth, health) is merged into qa; PR 2 (imports, undo, repair) and PR 3 (transactions, totals, review, rates, rebuild, export, delete-all) are not started. | data-architecture spec: architecture.md, Contracts; progress-smart-finances-imports.json and progress-smart-finances-reads.json |
| F-3 | api | Errors are { error: { code, message } } with codes unauthorized, bad_request, not_found, conflict, source_file_only, too_large; anything else is 500 with code internal. Replies are JSON. | smart-finances:apps/api/src/handlers/http.mjs#HttpError; smart-finances:apps/api/src/handlers/http.mjs#fail |
| F-4 | api | The person is only the verified token's sub claim. No route takes a person id from the path, query or body, so the web app never sends one. | data-architecture spec: architecture.md, Contracts, "Identity" |
| F-5 | api | Cross-origin calls are allowed only from http://localhost:3000, in dev and qa, for GET, POST, PUT and DELETE with the authorization and content-type headers. Staging and prod lists are empty, which also leaves the upload bucket with no browser rule. The list is the webOrigins context in infra/cdk.json, passed to both stacks. | smart-finances:infra/lib/stage.ts#addStage; smart-finances:infra/lib/data-stack.ts#DataStack |
| F-6 | auth | Sign-in pool: no self sign-up, email sign-in, TOTP required (no SMS), email-only recovery. The web client is public, SRP-only, with OAuth and the hosted page off, and token lifetimes left at the defaults. The API's token check takes the client id as audience. | smart-finances:infra/lib/data-stack.ts#DataStack; smart-finances:infra/lib/api-stack.ts#ApiStack |
| F-7 | auth | The pool id and client id are published only as stage parameters under /smart-finances/<stage>/; the API stack reads them through one custom resource, and its one output is its URL. | smart-finances:infra/lib/stage-values.ts#readStageValues; smart-finances:infra/lib/data-stack.ts#DataStack |
| F-8 | api | Uploads: POST /imports returns a presigned form; the browser posts the file straight to storage, valid 15 minutes, up to 20 MiB for budgets and 5 MiB for other sources. Names: payments report and csv end in .csv, the notes log in .md, a budget matches name_Mon_YYYY.xlsx. | data-architecture spec: architecture.md, "HTTP routes"; pr-smart-finances-imports.md, task for POST /imports |
| F-9 | api | Import statuses a reader sees: requested, importing, reconciling, unchanged, done, superseded, failed, ignored, plus expired (file never arrived) and stalled, computed on read. GET /imports pages hold 50, newest first. | data-architecture spec: architecture.md, "States and exits" |
| F-10 | api | Money is integer cents; rates are two-decimal strings. Totals nest kind, category, currency. The dollar view lists months with pesos and no rate in missing_rates. Only expense counts as spending and only income as earnings. | smart-finances:apps/api/src/ingest/schema.mjs#KINDS; data-architecture spec, "HTTP routes" |
| F-11 | api | Review choices exist only for payments report rows; other sources answer source_file_only. Approving hides the needs_review and possible_duplicate reasons. | data-architecture spec: architecture.md, "HTTP routes", PUT review |
| F-12 | api | Delete-all needs the typed confirm DELETE, returns counts, and is refused while an import runs. For 65 minutes after, imports and totals answer conflict. Erased items stay restorable for 35 days, and an erase marker stays. | data-architecture spec: architecture.md, "States and exits" and Components |
| F-13 | schema | The row fields and kinds are exported as plain lists, but the same module loads a server-only hashing module, so a browser bundle cannot import it as is. No list of category names is exported; categories come from match rules. | smart-finances:apps/api/src/ingest/schema.mjs#FIELDS; smart-finances:apps/api/src/ingest/categories.mjs#categoryFor |
| F-14 | platform | npm workspaces include apps/*, so apps/web is already a workspace: a stub with a name only. Node 20 or newer; CI uses Node 22. | smart-finances:package.json; smart-finances:apps/web/package.json |
| F-15 | platform | Tests run on the built-in node test runner; root npm test runs only the API tests. No lint or formatter config exists, only .editorconfig. TypeScript is a dependency of infra only. | smart-finances:package.json; smart-finances:.editorconfig |
| F-16 | platform | CI runs on pushes to qa, staging and main: npm ci at the root, an infra type-check, then a deploy of the API stack. It never builds, tests or deploys the web app. | smart-finances:.github/workflows/deploy.yml |
| F-17 | platform | The hosting project config turns Git deploys off and nothing else. main and staging still hold the old Angular app, which has no such file. | smart-finances:vercel.json; README.md, "Status" |
| F-18 | platform | No ADR picks the web framework or the web host. The plan's default host is Next.js on Amplify Hosting, with a static export on S3 and CloudFront as the alternative; the repo has a Vercel config. | smart-finances:docs/adr/README.md; plan doc, "Target architecture and decisions" |
| F-19 | trust | No assistant backend exists or is planned before Epic 4; its contract (route, streaming, citation and tool-call shape) is undefined. ADR 0002 notes streaming may need another path. | smart-finances:docs/adr/0002-api-type.md; data-architecture spec: intent.md, No-gos |
| F-20 | trust | Threat model: imported text and retrieved documents are untrusted (B4); model output must render as plain text or sanitized markdown (LLM05, AC8); traces record ids, not raw text (B3); tools are read-only (LLM06, AC6). | smart-finances:docs/threat-model.md |
| F-21 | trust | The synthetic data has 8 hostile rows: four formula starts, two prompt injections, an HTML image payload and a 2,000-character string. Export neutralises formula starts. | smart-finances:data/synthetic/generate.mjs; smart-finances:apps/api/src/ingest/schema.mjs#toCsv |
| F-22 | plan | Epic 1 asks for: a design brief; a design system (light and dark tokens, income, expense and savings colours, colour-blind-safe charts); screens for import, dashboard (net worth, spend by category, savings-rate trend), transactions, assistant, settings and data controls; trust states (citations, tool trace, refusal, uncertainty, rate limit); empty, loading, error and partial-import states; one critique round; tokens exported to Tailwind and shadcn. | plan doc, "Epic 1" |
| F-23 | plan | Epic 3 asks for Next.js with the exported tokens, shadcn and in-app sign-in; charts with text alternatives; server-side filter, sort and paging; an import screen with partial-failure report; data controls; keyboard, contrast and reduced-motion pass; a strict content policy; tokens kept out of local storage. | plan doc, "Epic 3" |
| F-24 | data | No source sends account balances, so net worth has no data behind it. | smart-finances:apps/api/src/ingest/schema.mjs#FIELDS |
| - | callers | Callers of the touched code: the planned web app (only client of the new screens); the old Angular app on main (no link to the new API, D-2); the local import script (uses importers directly, unaffected); staging checks run by a person. | smart-finances:scripts/ingest-local.mjs; README.md, "Branches" |

## Research unknowns
<!-- Where each high-impact unknown from research goes. -->
| Unknown | Impact | Goes to |
|---|---|---|
| Web host for staging and prod, and so the allowed web addresses and the deploy path | high | D-45 (was Q-1) |
| Whether the assistant screens are built now against a fake, or designed now and built with the Epic 4 contract | high | D-46 (was Q-2) |
| Where sign-in tokens live in the browser, and whether any data or chat is kept there | high | D-47 (was Q-3) |
| How the app learns the API address, pool id and client id per stage | high | design: a two-way decision at DP3 |
| Where the browser-safe schema and category list live (the data spec left this to this one) | high | design decision, then a task that splits a browser-safe module out |
| Whether CI gains web build, lint and test steps | high | design decision, then a task |
| Net worth on the dashboard with no balance source (F-24) | medium | no-go in intent.md, settled by D-18 and D-48 |
| Whether the delete-all screen states the 35-day recovery window (F-12) | medium | AC-7 |
| Which token the API accepts (ID or access) and the first sign-in steps (new password, authenticator setup) | high | live check on qa with a test user, a HUMAN need |
| Whether the hosting project still deploys the old app from main or staging | high | live check, a HUMAN need |
| When the data PRs merge into qa | high | live check before handoff; re-pin refs then |
