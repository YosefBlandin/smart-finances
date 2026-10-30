---
spec: web-ui
ticket: none
tier: L
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
- Serves: AC-11, AC-10; D-12, D-13, D-15 to D-17, D-21, D-22, D-25, D-27, D-32 to D-34, D-57, D-58.

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
- Serves: AC-2, AC-11, AC-5 to AC-9; D-13, D-18 to D-21, D-23, D-26 to D-31, D-34.

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
