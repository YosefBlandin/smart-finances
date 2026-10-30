---
spec: web-ui
ticket: none
tier: L
status: draft
---
# Web UI: design system and screens: research

<!-- Evidence only; the design lives in architecture.md. Read-only work: git show, git grep, read-only cloud calls. Line numbers are allowed only in this file, as path:L10-24 (repo:path:L10-24 in a multi-repo spec; no #, so drift ignores it), pinned to the refs in intent.md. Sections state corrected facts only. Examples sit in these comments. -->

## Scope
<!-- Areas covered, repos and refs read, and how this was produced (area sweep, then a verifier re-checks the facts that will become decisions). At most 3 lines. -->

## Facts
<!-- One verified fact per row, with evidence. Give a row an F id only when another file cites it; otherwise put - in the first cell. Example row: | F-1 | write path | Every signed-in call writes one event after the response. | api:src/events/log.ts:L97-121 | -->
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

## Corrections
<!-- Where two sources disagreed or an earlier claim was wrong: the claim, the resolved fact, and the evidence that settles it. Example row: | 1 | The docs say old events expire after 30 days. | Old events have no expiry set, so they never expire. | live check 1 | -->
| # | Earlier claim | Resolved fact | Evidence |
|---|---|---|---|

## Assumptions
<!-- What we believe but have not verified. Importance and evidence are high, medium or low. High importance with low evidence needs a live check, a question or a task. Example row: | Production has the same table shape as staging. | high | low | live check on production by a person | -->
| Assumption | Importance | Evidence | Next step |
|---|---|---|---|

## Unknowns
<!-- What nobody knows yet. Every high-impact unknown points to a question, a task or a live check. Example row: | Whether page views from the mobile app are needed. | high | Q-1 | -->
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

## Live checks
<!-- Read-only checks against real systems. Record counts, attribute names and internal ids only: never item values, names, emails or IPs. Example row: | 1 | Expiry on staging events | count events without an expiry (read-only) | 42 events have none | 2026-10-30 | -->
| # | Check | Command or steps | Result | Date |
|---|---|---|---|---|

## Resolved from code
<!-- Questions someone would ask that the code already answers. Nobody re-asks these. -->
| Question | Answer | Evidence |
|---|---|---|
