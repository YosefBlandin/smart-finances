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

## Components
<!-- One subsection per component that changes: what changes, where (<repo>:<path>#<Symbol>), which ACs and decisions it serves, and what stays the same. -->

## Contracts
<!-- The single home for every interface that crosses a boundary: endpoints, request and response shapes, events, stored row shapes, error codes. Briefs link here; they never copy a contract. -->

## Alternatives
<!-- Only for real technical forks, one table per fork under its own heading. Include the cost a reviewer would ask about. Record the chosen option as a decision in decisions.md and cite its id in the fork heading. A 1-way or stakeholder fork keeps its options in decisions.md instead. Example fork:
### Fork: where the new route lives (D-2)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. Extend the main service | no new deploy; its config is near a size limit | none | rejected |
| B. A branch in an existing handler | one small change; mixes a write into a reader | branch on the route | viable |
| C. A new small service | one more deploy to watch | one route file and one registration | chosen |
-->

## States and exits
<!-- For anything with a lifecycle (jobs, sessions, retries, rollout windows): each state, how it starts, how it ends, and what happens on failure or timeout. The pre-mortem lens reviews this table. -->
| State | Entered when | Exits when | On failure or timeout |
|---|---|---|---|

## Cross-cutting
<!-- One short paragraph, or "none", for each: security and permissions; personal data and logs; performance and cost; deploy and infrastructure; observability; old clients. M tier: release order and rollback go here, because M has no release.md. -->

## Risks
<!-- Risks left after the design. Mitigation names a test, a check, or the decision that accepts the risk. At design, describe the test in words; handoff adds its id. Owner is a role. Example row: | RK-1 | Events written before the release have no page type, so the new filter misses them. | high | low | Accepted in D-1; old events expire on their own. | product | -->
| RK | Risk | Likelihood | Impact | Mitigation or acceptance | Owner |
|---|---|---|---|---|---|

## Facts
<!-- M tier only: the research facts design uses. L keeps facts in research.md, so delete this section. One fact per row; evidence is <repo>:<path>#<Symbol>, never line numbers. Give a row an F id only when another file cites it; otherwise put - in the first cell. Example row: | F-1 | write path | Every signed-in call writes one event after the response. | api:src/events/log.ts#writeEvent | -->
| F | Area | Fact | Evidence |
|---|---|---|---|
| F-1 | api | At the pin, the API is one hello function behind a catch-all route, with no sign-in check and no cross-origin rule. No data route is live on qa. | smart-finances:infra/lib/api-stack.ts#ApiStack |
| F-2 | api | The data routes, request and response shapes, error codes and paging are fixed in the data-architecture spec, Contracts, "HTTP routes": 15 routes. They ship in its PR 1 (health), PR 2 (imports, undo, repair) and PR 3 (transactions, totals, review, rates, rebuild, export, delete-all). None is merged yet. | data-architecture spec: architecture.md, Contracts; briefs pr-smart-finances-imports.md and pr-smart-finances-reads.md |
| F-3 | api | Errors are { error: { code, message } } with codes unauthorized, bad_request, not_found, conflict, source_file_only, too_large; anything else is 500 with code internal. Replies are JSON. | data-foundation branch: apps/api/src/handlers/http.mjs, HttpError and fail |
| F-4 | api | The person is only the verified token's sub claim. No route takes a person id from the path, query or body, so the web app never sends one. | data-architecture spec: architecture.md, Contracts, "Identity" |
| F-5 | api | Cross-origin calls are allowed only from http://localhost:3000, in dev and qa, for GET, POST, PUT and DELETE with the authorization and content-type headers. Staging and prod lists are empty, which also leaves the upload bucket with no browser rule. | data-foundation branch: infra/cdk.json webOrigins; infra/lib/api-stack.ts and infra/lib/data-stack.ts |
| F-6 | auth | Sign-in pool: no self sign-up, email sign-in, TOTP required (no SMS), email-only recovery. The web client is public, SRP-only, with OAuth and the hosted page off, and token lifetimes left at the defaults. | data-foundation branch: infra/lib/data-stack.ts, DataStack.userPool and DataStack.webClient |
| F-7 | auth | The pool id and client id are published only as stage parameters under /smart-finances/<stage>/; the API stack's one output is its URL. | data-foundation branch: infra/lib/data-stack.ts and infra/lib/api-stack.ts |
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
