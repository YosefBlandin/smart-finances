---
spec: data-architecture
ticket: none
tier: L
status: locked-v3
---
# Data architecture: model, store, access patterns, ingestion and auth: research

<!-- Evidence only; the design lives in architecture.md. Read-only work: git show, git grep, read-only cloud calls. Line numbers are allowed only in this file, as path:L10-24 (repo:path:L10-24 in a multi-repo spec; no #, so drift ignores it), pinned to the refs in intent.md. Sections state corrected facts only. Examples sit in these comments. -->

## Scope
<!-- Areas covered, repos and refs read, and how this was produced (area sweep, then a verifier re-checks the facts that will become decisions). At most 3 lines. -->
- Areas: access patterns, store choice, ingestion, auth and permissions, code layout. One repo, read at 7ce1ffb (HEAD differs only under docs/specs).
- Produced by the spec-research workflow (one read-only agent per area, then a verifier that re-checked 30 decision-critical facts; 7 corrections applied below), plus read-only AWS checks on the project profile (D-3) and the project's 8-week plan document.

## Facts
<!-- One verified fact per row, with evidence. Give a row an F id only when another file cites it; otherwise put - in the first cell. Example row: | F-1 | write path | Every signed-in call writes one event after the response. | api:src/events/log.ts:L97-121 | -->
| F | Area | Fact | Evidence |
|---|---|---|---|
| - | model | The transaction row has 14 fields: id, date, date_precision, kind, amount, currency, category, merchant, description_raw, source, source_ref, country, flags, import_batch. No user or owner, account, review state, override, timestamp or version field. | apps/api/src/ingest/schema.mjs:L5-20 |
| - | model | Amounts are signed integer cents in memory (money out is negative) and two-decimal strings on disk; toCents and fromCents use integer math only. | apps/api/src/ingest/schema.mjs:L1-2,L10,L29-41 |
| - | model | The Excel importer converts numeric cells with Math.round(Number(v) * 100), so a float touches money on that path, against the schema's header rule. | apps/api/src/ingest/excel.mjs:L40,L119,L158 |
| - | model | Seven kinds. Only expense counts as spending and only income as earnings; inflow, refund, interest, transfer_out and loan_out stay so balances add up. | apps/api/src/ingest/schema.mjs:L22-24 |
| - | model | date is YYYY-MM-DD; date_precision is day or month, and month-only rows are dated the 1st, so the month key is the first 7 characters. | apps/api/src/ingest/schema.mjs:L7-8 |
| - | model | currency is stored as recorded (ARS or USD) and never converted; report totals are keyed by category plus currency. | apps/api/src/ingest/reconcile.mjs:L140-157 |
| - | model | All three importers write merchant as an empty string; merchant text exists only inside description_raw. | apps/api/src/ingest/mercadopago.mjs:L101; apps/api/src/ingest/notion.mjs:L100; apps/api/src/ingest/excel.mjs:L138-153 |
| - | model | flags mixes review markers (needs_review, possible_duplicate) with information notes (bcv_rate, summed, reserve_only, assumed_fee, cash_untracked, day_month_swapped, no_date, date_conflict). Importers recompute flags on every run. | apps/api/src/ingest/schema.mjs:L18 |
| - | model | needs_review is set on every Mercado Pago payout and inflow, Excel savings inflows, Other income and Uncategorized expenses, and Notion Uncategorized lines and wallet transfers. | apps/api/src/ingest/mercadopago.mjs:L28-45; apps/api/src/ingest/excel.mjs:L68-81 |
| - | model | category is free text from ordered rules; unmatched labels become Uncategorized. | apps/api/src/ingest/categories.mjs:L4-28 |
| - | model | The schema comment lists source as mercadopago or notion, but the Excel importer writes excel. No JSON Schema, types or runtime validator exist. | apps/api/src/ingest/excel.mjs:L148; apps/api/src/ingest/schema.mjs:L1-61 |
| - | ids | id is sha256 of the parts joined with U+241F, cut to 16 hex characters; every hash starts with the source name and none includes a user. | apps/api/src/ingest/schema.mjs:L26 |
| - | ids | Mercado Pago id = source, SOURCE_ID, month of the opening row. File name is not part of it (tested). An empty SOURCE_ID falls back to the row index, which is not stable across files. | apps/api/src/ingest/mercadopago.mjs:L73-94; apps/api/test/mercadopago.test.mjs:L51-55 |
| - | ids | Mercado Pago amount is the net of each SOURCE_ID group within the month, so a later download with extra rows for the same operation gives the same id with a different amount. Zero-net operations are dropped and counted. | apps/api/src/ingest/mercadopago.mjs:L60-112 |
| - | ids | Notion id = source, date, lowercased line, occurrence within the month. Editing a line or inserting an identical earlier line changes ids and orphans the old rows. | apps/api/src/ingest/notion.mjs:L89-93 |
| - | ids | Excel id = source plus a key of year-month, side, description, sheet category, amount and raw date, plus occurrence. Any cell edit gives a new id. The month comes from the file name, which must match …_MMM_YYYY.xlsx. | apps/api/src/ingest/excel.mjs:L83-88,L98-139 |
| - | ids | import_batch is source plus 12 hex characters of sha256 over the file content. It is a label only: no batch record, status, counts or rollback code. | apps/api/src/ingest/schema.mjs:L19-27 |
| - | ingest | The three parsers are pure: text or Buffer plus options in, { transactions, issues?, check } out. Only node:crypto and node:zlib are imported; no fs, network or env. | apps/api/src/ingest/mercadopago.mjs:L54-133; apps/api/README.md:L5-7 |
| - | ingest | The Notion parser carries state line to line (year rollover, income or expense section, country marker), so a log must be parsed whole and in order. | apps/api/src/ingest/notion.mjs:L42-67 |
| - | ingest | Notion and Excel list unreadable rows in issues and skip them; Notion's issues also hold info-only entries for kept rows. Excel throws on a bad file name, missing sheets or a wrong header; Mercado Pago throws on quoted fields, missing columns, a bad amount or a bad opening or totals row. | apps/api/src/ingest/notion.mjs:L40-86; apps/api/src/ingest/excel.mjs:L84-96,L115-118; apps/api/src/ingest/mercadopago.mjs:L17-26,L58-59 |
| - | ingest | The Mercado Pago check object (row counts, opening, month-end and closing balances, balance breaks, match booleans) is per file. The month-to-month chain check runs only in buildReport over all files. Balances are not stored on rows. | apps/api/src/ingest/mercadopago.mjs:L113-131; apps/api/src/ingest/reconcile.mjs:L108-115 |
| - | ingest | combine drops repeated ids (first wins, so a row in two files keeps the first file's batch) and sorts. possible_duplicate needs all Excel rows at once: it matches an issue's stated date, amount and description against day-precise rows and flags the twin, which still counts in totals. | apps/api/src/ingest/reconcile.mjs:L11-37 |
| - | ingest | The xlsx reader caps the file at 20 MiB and each inflated part at 50 MiB, parses XML by regex (no DTD or entities) and reads cached formula values only. It has no cap on entry count or total inflated size, inflates parts it never reads, and skips CRC checks. Mercado Pago and Notion inputs have no size cap. | apps/api/src/ingest/xlsx.mjs:L6-42; apps/api/src/ingest/notion.mjs:L37-46 |
| - | ingest | toCsv prefixes text cells starting with = + - @ tab or CR with a quote; stored values stay raw. | apps/api/src/ingest/schema.mjs:L43-61 |
| - | ingest | Synthetic data uses a fourth shape (date, description, amount, currency, account): 663 rows over 12 months, mixed ARS and USD, 20 exact duplicates, 8 adversarial rows, with a ground-truth file for evals. No importer reads it. | data/synthetic/README.md:L9-24; data/synthetic/generate.mjs:L123-127 |
| - | store | ADR 0003 (accepted) picks DynamoDB on-demand, single table, with a Streams-driven rollup Lambda for monthly totals by category. It sizes the load at about 700 rows a year for one user and requires idempotent writes and rollups (Streams deliver at least once). | docs/adr/0003-data-store.md:L3-20 |
| - | store | ADR 0003 names no keys, indexes, rollup shape, TTL, backups or encryption; it defers access patterns to ADR 0004, which with 0005 (chunking) is only planned in the index. | docs/adr/0003-data-store.md:L1-23; docs/adr/README.md:L6 |
| - | store | ADR 0003 accepts no ad hoc joins or aggregates (assistant tools must map to known access patterns) and lists its revisit triggers. Aurora Serverless v2 is the noted alternative, with its cost floor unchecked. | docs/adr/0003-data-store.md:L9-11,L16-23 |
| - | store | No database client or package is declared anywhere; apps/api has no dependencies. | apps/api/package.json:L1-8 |
| - | infra | The CDK app has two stacks: the GitHub OIDC stack (deployed by hand) and a per-stage API stack named smart-finances-api-stage. | infra/bin/app.ts:L12-24 |
| - | infra | The API stack holds one hello Lambda (Node 22, 128 MB, 5 s, raw asset of apps/api/src/hello, no bundler), its own role limited to its log group, and an HTTP API with one catch-all integration, no authorizer, no routes, no CORS, throttled at 10 rps burst 20. | infra/lib/api-stack.ts:L14-58 |
| - | infra | Because the asset is only src/hello, a handler importing ../ingest would not have those files in its zip. | infra/lib/api-stack.ts:L36 |
| - | infra | Reserved concurrency is off by default because the account's Lambda concurrency is 10; a stream consumer would share that pool. | infra/lib/api-stack.ts:L19-20,L41-44 |
| - | infra | The deploy role trusts this repo's main, staging and qa via OIDC and can only assume the cdk-hnb659fds bootstrap roles, so new resource types need no deploy-role change. | infra/lib/github-oidc-stack.ts:L29-53 |
| - | infra | CI runs npm ci, the infra type check and cdk deploy; it does not run npm test. Actions are pinned to @v4 tags, not commit hashes. | .github/workflows/deploy.yml:L3-45 |
| - | auth | ADR 0002 picks an HTTP API with a Cognito JWT authorizer (Epic 2), validation in Lambda code; WAF on an HTTP API is marked unverified, with CloudFront plus WAF planned for Epic 6. | docs/adr/0002-api-type.md:L12-19 |
| - | auth | ADR 0001 accepts the default AdministratorAccess bootstrap execution policy until Epic 6; the threat model names it the main escalation path on B5. | docs/adr/0001-iac-tool.md:L19; docs/threat-model.md:L47 |
| - | threat | Assets already list Transactions (DynamoDB) and Uploaded files (S3). Boundaries are B1 browser to API, B2 Lambda to stores, B3 Bedrock, B4 untrusted data into model context, B5 GitHub to AWS. | docs/threat-model.md:L11-28 |
| - | threat | B1 requires identity from the verified JWT only. B2 plans one role per function with resource-scoped policies, idempotent writes keyed by row hash, and block-public-access plus customer-managed KMS keys; none is marked done. | docs/threat-model.md:L7,L36-39 |
| - | threat | No STRIDE row covers the upload path (presigned URL scope, size and type, hostile workbooks), table encryption or backup, data deletion, or Cognito sign-up and account takeover. | docs/threat-model.md:L30-45 |
| - | layout | npm workspaces are apps/*, infra and evals; no shared package. Root test runs node --test on apps/api tests only. Node 20 or newer; Lambda and CI use Node 22. | package.json:L6-18 |
| - | layout | apps/web and evals are placeholders (package.json with name and version, one-line README). No OpenAPI, route list or shared types exist. | apps/web/package.json:L1-5; evals/package.json:L1-5; docs/adr/0002-api-type.md:L19 |
| - | layout | infra compiles as CommonJS through ts-node and type-checks only bin and lib. apps/api is ESM through .mjs, with no type, main or exports field. | infra/tsconfig.json:L1-15; apps/api/package.json:L1-8 |
| - | layout | vercel.json turns off Vercel Git deploys until apps/web is a real app. | vercel.json:L1-6 |
| - | callers | scripts/ingest-local.mjs is the only runtime caller of the importers, combine, toCsv and buildReport; it writes data/real/clean and exits 1 on a failed check. | scripts/ingest-local.mjs:L14-46 |
| - | callers | Other callers: apps/api tests (schema, mercadopago, notion, excel), the hello Lambda (no data), scripts/mercadopago-report.mjs (produces inputs only), data/synthetic/generate.mjs (eval data), the deploy workflow, and the planned apps/web and evals. The old Angular app on Vercel is deprecated and has no link to the store. | apps/api/test/excel.test.mjs:L4-7; apps/api/src/hello/index.mjs:L1-5; README.md:L18-20 |
| - | aws docs | Lambda reads DynamoDB stream records at least once; stream order is kept per item, not per partition key; records live 24 hours. | docs.aws.amazon.com/lambda/latest/dg/with-ddb.html; docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html |
| - | aws docs | S3 event notifications are delivered at least once; async Lambda invokes retry twice on error and may repeat without one. | docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.html; docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html |
| - | aws docs | Table encryption can switch between AWS-owned, AWS-managed and customer-managed keys on an existing table. Point-in-time recovery is billed per GB-month. The free tier's request allowance applies to provisioned capacity; on-demand gets the 25 GB storage allowance. | docs.aws.amazon.com/amazondynamodb/latest/developerguide/EncryptionAtRest.html; aws.amazon.com/dynamodb/pricing |
| - | aws docs | dynamodb:LeadingKeys only scopes per person when callers hold per-person credentials; a shared function role cannot use it that way. | docs.aws.amazon.com/amazondynamodb/latest/developerguide/specifying-conditions.html |
| - | aws docs | The HTTP API JWT authorizer puts claims at requestContext.authorizer.jwt.claims and checks aud, or client_id when aud is absent, against the audience list. WAF attaches to REST APIs, not HTTP APIs. | docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html; docs.aws.amazon.com/waf/latest/developerguide/waf-chapter.html |
| - | aws docs | A presigned POST policy supports an exact key and a content-length range; a presigned PUT cannot set a maximum size. | docs.aws.amazon.com/AmazonS3/latest/API/sigv4-HTTPPOSTConstructPolicy.html |
| - | aws docs | Lambda recommends bundling the SDK clients a function uses; NodejsFunction bundles with a local esbuild (root package.json in a monorepo) and falls back to Docker. | docs.aws.amazon.com/lambda/latest/dg/nodejs-handler.html; docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs-readme.html |
| - | aws docs | Cognito MFA can be changed after the pool exists; self sign-up can be turned off; sub is unique per pool and fixed for the user. New pools default to the Essentials plan (10,000 monthly active users free). | docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa.html; docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-attributes.html |
| - | plan | The 8-week plan (outside the repo) asks for: access patterns modelled first and written into ADR 4 (list by month, filter by category, search by merchant); Streams rollups proven idempotent by replaying a file twice; server-side filter, sort and pagination; read-only assistant tools with identity injected from the JWT; delete-all covering S3 objects and vectors; a separate AWS account; a budget alarm before the first deploy. | plan document, Epics 0, 2, 3 and 4 |

## Corrections
<!-- Where two sources disagreed or an earlier claim was wrong: the claim, the resolved fact, and the evidence that settles it. Example row: | 1 | The docs say old events expire after 30 days. | Old events have no expiry set, so they never expire. | live check 1 | -->
| # | Earlier claim | Resolved fact | Evidence |
|---|---|---|---|
| 1 | Floats never touch money (schema header). | The Excel importer multiplies a float by 100 and rounds. | apps/api/src/ingest/excel.mjs:L40 |
| 2 | Unparseable rows are skipped and listed, never fatal. | Only for Notion and Excel rows. Excel file-level problems and any Mercado Pago problem fail the whole file. | apps/api/src/ingest/excel.mjs:L84-96; apps/api/src/ingest/mercadopago.mjs:L17-26,L58-59 |
| 3 | Re-importing the same file never changes stored rows. | True only for byte-identical input. Overlapping Mercado Pago downloads can change an amount under the same id; edited Notion or Excel files produce new ids and orphan old ones. | apps/api/src/ingest/mercadopago.mjs:L60-112; apps/api/src/ingest/notion.mjs:L89-93; apps/api/src/ingest/excel.mjs:L98-139 |
| 4 | Scale is a few hundred new rows a month (intake note). | ADR 0003 says about 700 a year; synthetic data is about 55 a month; the local history is in the low thousands over about two years. All fit one partition per user per month. | docs/adr/0003-data-store.md:L6; data/synthetic/README.md:L16-20 |
| 5 | The project runs in its own AWS account with a budget alarm (plan Epic 0). | The account also holds other projects' stacks, tables and a user pool, and has no budget or billing alarm. | live checks 1, 4, 5 |
| 6 | The source field is mercadopago or notion. | Excel writes excel too. | apps/api/src/ingest/excel.mjs:L148 |

## Assumptions
<!-- What we believe but have not verified. Importance and evidence are high, medium or low. High importance with low evidence needs a live check, a question or a task. Example row: | Production has the same table shape as staging. | high | low | live check on production by a person | -->
| Assumption | Importance | Evidence | Next step |
|---|---|---|---|
| The parsers run unchanged in a Lambda that reads the S3 object; Excel also needs the object key as its file name. | high | high | Task: thin handler test with a synthetic fixture. |
| Identity reaches a handler as the Cognito sub claim under requestContext.authorizer.jwt.claims once a JWT authorizer exists. | high | medium | Task: unit test on a synthetic HTTP API v2 event. |
| Widening the Lambda asset to apps/api/src lets handlers import ../ingest with no bundler. | high | medium | Task: cdk synth and inspect the asset. |
| Nothing but the hello API is deployed for this project, so changing the store needs no data migration. | high | high | Done: live checks 1 and 2. |
| Rollup totals must be keyed by month, category and currency, and must handle category changes and deletes, not only inserts. | high | medium | Design: replay tests for insert, modify and remove, each delivered twice. |
| The import screen needs a stored batch record (status, counts, quarantined rows and reasons); today checks and issues live only in memory. | high | high | Design: batch and quarantine item shapes. |
| Text search on description fits a filter over one user's month, given about 60 rows a month. | medium | medium | Design: confirm in ADR 0004. |
| Many 50 MiB parts in one workbook could exhaust Lambda memory despite the per-part cap. | medium | medium | Task: synthetic zip test under a fixed memory limit. |
| At this scale a tool could load all of one user's rows and aggregate in memory, reducing the need for rollups. | medium | medium | Design: weigh against ADR 0003 in ADR 0004. |
| Node 22 on Lambda loads .mjs handlers as ESM without a type field. | medium | high | Proven by the deployed hello Lambda. |
| A 64-bit id is enough at this volume. | low | high | Revisit only if many users are in scope (Q-1). |
| Evals read the synthetic CSV shape, not the stored row shape. | low | medium | Design: pick with the synthetic importer task. |
| No TTL is needed. | low | medium | Design: confirm for staging items. |

## Unknowns
<!-- What nobody knows yet. Every high-impact unknown points to a question, a task or a live check. Example row: | Whether page views from the mobile app are needed. | high | Q-1 | -->
| Unknown | Impact | Goes to |
|---|---|---|
| One user forever, or several users; decides the key prefix, ids and vector filters. | high | Q-1 |
| Reporting currency and which ARS to USD rate, from where and as of which date. | high | Q-2 |
| What approve, recategorize and confirm-duplicate mean, and whether edits survive a re-import. | high | Q-3 |
| What a re-uploaded or edited file does to earlier rows, and how rollback by batch works when an id sits in two files. | high | Q-4 |
| Separate AWS account and a budget guard before real data is loaded. | high | Q-5 |
| How net worth is defined (accounts, balance snapshots), or whether it leaves this scope. | high | intent, no-go candidate at DP2 |
| Which assistant questions must be answerable; no golden set exists yet. | high | design: derive from plan Epic 4 tools and Epic 5 categories |
| Duplicate detection and the month chain check: per file against the store, or a separate pass over all data. | high | design |
| Cognito: sign-up off, MFA, token flow, and whether the pool lives in a retained stack apart from the API stack. | high | design (two-way defaults) |
| Table encryption key (AWS-owned or customer-managed), backups and deletion protection per stage. | high | design (two-way) |
| Shared schema: a new workspace package or an exports map on apps/api; and how apps/web consumes it. | high | design |
| DynamoDB on-demand pricing and free tier; Streams delivery, retention, ordering and retries; Aurora Serverless v2 minimum capacity and pause. | high | task: AWS docs check before ADR 0004 |
| Source format detection on upload (key prefix, extension or content). | high | task |
| Importer for the synthetic CSV shape for evals and the demo. | high | task |
| Merchant name cleanup from description text. | medium | design |
| Size caps for CSV and markdown, and a total inflated cap for workbooks. | low | task |
| Whether CI should run npm test and pin actions to hashes in this work or in Epic 6. | low | design |
| Whether WAF attaches directly to an HTTP API. | low | task: AWS docs check |
| Vector store and chunking that delete-all must cover (ADR 0005). | low | assumption: out of this scope |

## Live checks
<!-- Read-only checks against real systems. Record counts, attribute names and internal ids only: never item values, names, emails or IPs. Example row: | 1 | Expiry on staging events | count events without an expiry (read-only) | 42 events have none | 2026-10-20 | -->
| # | Check | Command or steps | Result | Date |
|---|---|---|---|---|
| 1 | Deployed stacks | aws cloudformation list-stacks (project profile, us-east-1) | smart-finances-api-dev, smart-finances-api-qa, smart-finances-github-oidc and CDKToolkit, plus one other project's stack. No staging or prod stack. | 2026-10-20 |
| 2 | qa stack contents | list-stack-resources smart-finances-api-qa | 10 resources: API, integration, route, stage, Lambda, permission, role, policy, log group, metadata. Dev also has 10. | 2026-10-20 |
| 3 | Bootstrap execution policy | describe-stacks CDKToolkit; list-attached-role-policies on the cfn-exec role | Qualifier hnb659fds, default resources, execution role has AdministratorAccess. | 2026-10-20 |
| 4 | Stores and pools in the account | dynamodb list-tables; cognito-idp list-user-pools; s3api list-buckets | 3 tables, 1 user pool and 1 bucket, all from other projects; the CDK assets bucket. None for this project. | 2026-10-20 |
| 5 | Cost guards | budgets describe-budgets; cloudwatch alarms in AWS/Billing | 0 budgets, 0 billing alarms. | 2026-10-20 |
| 6 | Lambda concurrency | lambda get-account-settings | Account limit is 10. | 2026-10-20 |

## Resolved from code
<!-- Questions someone would ask that the code already answers. Nobody re-asks these. -->
| Question | Answer | Evidence |
|---|---|---|
| Is re-importing the exact same file idempotent? | Yes: ids and import_batch are deterministic from content, and combine drops repeated ids. | apps/api/src/ingest/reconcile.mjs:L11-17 |
| Are the same payments from two sources deduped? | No: every id starts with the source name. | apps/api/src/ingest/schema.mjs:L26 |
| Are possible duplicates removed from totals? | No: flagged and still counted. | apps/api/src/ingest/reconcile.mjs:L22-35 |
| Is currency converted? | No. | apps/api/src/ingest/reconcile.mjs:L157 |
| Is merchant populated? | No, empty in all importers. | apps/api/src/ingest/mercadopago.mjs:L101 |
| Is CSV export safe against formula injection? | Yes, text cells get a quote prefix. | apps/api/src/ingest/schema.mjs:L43-52 |
| Where must identity come from? | The verified JWT only. | docs/threat-model.md:L36 |
| Which ADR holds the access-pattern table? | 0004; ADR 0003 is revisited by a new ADR, not edited. | docs/adr/README.md:L6; docs/adr/0003-data-store.md:L22-23 |
| What breaks if the store moves off DynamoDB? | No runtime code; only ADR 0003 and the threat model's asset and B2 rows. | docs/threat-model.md:L13-14 |
| Does a store change need new CI permissions? | No: the deploy role only assumes bootstrap roles. | infra/lib/github-oidc-stack.ts:L46-53 |
| Which branches deploy? | main to prod, staging and qa, enforced in the workflow and the role trust. | infra/bin/app.ts:L19 |
| Do per-function roles exist? | Yes, as a pattern on the hello Lambda. | infra/lib/api-stack.ts:L27-31 |
| What module format and test runner? | ESM through .mjs; node --test with node:assert/strict. | apps/api/package.json:L5-7 |
| Do the importers need npm packages? | No. | apps/api/README.md:L7 |
| What upload size limits exist? | Only in the xlsx reader: 20 MiB file, 50 MiB per part. | apps/api/src/ingest/xlsx.mjs:L6-7 |
