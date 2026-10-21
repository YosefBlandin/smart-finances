---
spec: data-architecture
ticket: none
tier: L
status: draft
---
# Data architecture: model, store, access patterns, ingestion and auth: architecture

<!-- Design by component. Cite code as <repo>:<path>#<Symbol>, never with line numbers; the drift script checks these refs. Add (new) after a file or symbol that a task creates. Cite ACs and decisions by id and never restate them. Executors read only the sections their tasks cite, so each section must stand on its own. Examples sit in these comments. -->

## Overview
<!-- 3 to 6 lines: the shape of the change and the data flow. Add a small diagram only if it saves words. -->
A new per-stage data stack holds one DynamoDB table, one private upload bucket and one Cognito user pool (D-13). The API stack adds a JWT authorizer and four functions (D-21). Upload: the browser asks for an upload form, posts the file straight to S3, and the S3 event runs the parser, which reuses the existing importers and writes rows under the signed-in person (D-6, D-12, D-15). Reads (list, totals, review list, export) query one person's rows for the asked months and filter, sort, page or sum them in the function; no totals are stored (D-14, D-26).

```
browser --JWT--> HTTP API --> api-read / api-write / api-delete --> table (+ bucket for delete)
browser --form POST--> bucket --event--> parser --> table
```

## Components
<!-- One subsection per component that changes: what changes, where (<repo>:<path>#<Symbol>), which ACs and decisions it serves, and what stays the same. -->

### Data stack
- smart-finances:infra/lib/data-stack.ts#DataStack (new), wired in smart-finances:infra/bin/app.ts as smart-finances-data-stage. Serves AC-19, D-12, D-13, D-19.
- Table: on-demand, keys in Contracts "Table items", no stream, point-in-time recovery on in every stage (35-day window, so erased items stay restorable that long; recorded in the threat model), deletion protection and retain-on-delete in staging and prod (D-19, D-13).
- Bucket: private, block public access, SSE-S3, enforce TLS, no versioning, CORS limited to POST from the stage's web origins, EventBridge notifications on (D-15, D-19).
- User pool: self sign-up off, users created by the owner, sign-in by email, TOTP MFA per D-18; one public app client (SRP and refresh, no secret). Retained in every stage, since the person key is the user's sub (D-13, D-6).
- Publishes table name, bucket name, pool id and client id as SSM parameters under /smart-finances/<stage>/; no CloudFormation exports, so the API stack can stop using a value without blocking a data stack deploy.
- A synth test pins the logical ids and the replacement-sensitive properties of the table (keys) and the pool (sign-in attributes), so a change that would replace either fails CI (D-13).

### API stack
- smart-finances:infra/lib/api-stack.ts#ApiStack reads the data stack's SSM parameters and builds ARNs from the names. Serves AC-1, AC-2, D-18, D-20, D-21.
- HTTP API: JWT authorizer (issuer = the pool, audience = the app client) on every route in Contracts "HTTP routes" except GET /health. The hello function moves to GET /health; the catch-all default integration is removed. Throttling stays at 10 rps, burst 20. CORS allows the stage's origins from the webOrigins map in infra/cdk.json (dev and qa: http://localhost:3000; staging and prod: empty until the web app has a host).
- Functions (NodejsFunction, Node 22, esbuild bundle with esbuild in the root package.json, one role each, one-month log group; D-20, D-21):
  - api-read: GET routes. 256 MB, 10 s. Table read only.
  - api-write: POST /imports, POST /imports/{id}/undo, PUT review, PUT rates. 256 MB, 10 s. Table read and write; s3:PutObject on the uploads/* object ARN (a presigned form acts with its signer's rights); lambda:InvokeFunction on parser.
  - api-delete: DELETE /data. 256 MB, 25 s. Table read and delete; s3:ListBucket on the bucket ARN with an s3:prefix condition of uploads/*; s3:DeleteObject on the uploads/* object ARN.
  - parser: 1024 MB, 5 minutes (below the 10-minute lock). Triggered by an EventBridge rule in the API stack for Object Created in the bucket under uploads/, and by async invoke for undo. Async retries stay at the default 2; no on-failure destination. s3:GetObject and s3:DeleteObject on the uploads/* object ARN; table read and write.
- No function gets a wildcard resource.

### Handlers
- smart-finances:apps/api/src/handlers/ (new): read.mjs, write.mjs, delete.mjs, parser.mjs. Each is a thin adapter: it reads the person from the verified claims (Contracts "Identity"), validates input, and calls the core below. Serves AC-1 to AC-18.
- smart-finances:apps/api/src/store/ (new): keys.mjs (builds every key from the person and parts; the only place keys are built), repo.mjs (DynamoDB and S3 calls behind a small interface so tests use an in-memory fake), and the core modules imports.mjs, totals.mjs, query.mjs, review.mjs, rates.mjs, erase.mjs.
- Handlers log ids, counts and status only, never descriptions or amounts.

### Importers
- Unchanged in behaviour for the local path (AC-20): smart-finances:apps/api/src/ingest/mercadopago.mjs#parseReleaseReport, smart-finances:apps/api/src/ingest/notion.mjs#parseNotionLog, smart-finances:apps/api/src/ingest/excel.mjs#parseBudgetWorkbook, smart-finances:apps/api/src/ingest/schema.mjs#FIELDS.
- smart-finances:apps/api/src/ingest/csv.mjs#parseGenericCsv (new): reads the synthetic shape; source csv, period log (D-23). Serves AC-4.
- smart-finances:apps/api/src/ingest/reconcile.mjs#combine: its possible-duplicate step moves into an exported findPossibleDuplicates (new) in the same file, called by combine (same output) and by the parser against the person's stored rows. Serves AC-13, AC-20.
- smart-finances:apps/api/src/ingest/xlsx.mjs#readWorkbook: caps entry count and total inflated size, and inflates only the parts it reads (D-25). Serves AC-6.
- smart-finances:apps/api/src/ingest/period.mjs#periodOf (new): source and parser result to period (D-16). A payments report keeps only its opening month's rows today; periodOf adds a skipped entry naming how many rows fell outside that month, so nothing is dropped silently.

### CI and docs
- smart-finances:.github/workflows/deploy.yml runs npm test (which includes the infra synth tests) before deploying, and deploys the data stack, then the API stack, of the stage (D-22).
- docs/adr/0004-access-patterns.md (new): keys, stores and retention, the access-pattern table and totals on read (D-6, D-12, D-13, D-14, D-26); it supersedes the stream rollup part of ADR 0003, whose status line says so. docs/adr/0006-imports-source-of-record.md (new): D-8, D-9, D-16, D-17, D-28. docs/adr/0007-shared-account.md (new): D-10. docs/adr/README.md lists them.
- docs/threat-model.md: data stack assets, the upload path, delete-all and the 35-day recovery window, Cognito sign-in, and the D-10 accepted risk.

## Contracts
<!-- The single home for every interface that crosses a boundary: endpoints, request and response shapes, events, stored row shapes, error codes. Briefs link here; they never copy a contract. -->

### Identity
- Person id = the sub claim at event.requestContext.authorizer.jwt.claims.sub. Missing or empty: 401 unauthorized. No route reads a person id from the path, query or body (AC-2).

### Table items
One table. Partition key pk, sort key sk, both strings. P = U#<sub>. All items of one person share one partition (D-12).

| Item | pk | sk | Attributes |
|---|---|---|---|
| Transaction | P | TXN#<date>#<id> | every schema field (amount as integer cents), period, import_id (the import whose file last wrote it) |
| Review choice | P | OVR#<id> | date, month, category (optional), approved (bool), updated_at; payments report rows only (D-8) |
| Import | P | IMP#<importId> | see "Import record" |
| Period pointer | P | PER#<source>#<period> | active_import, history (import ids of the files that counted, oldest first, no repeats, no cap), lock_import, lock_until |
| Rate | P | RATE#<yyyy-mm> | ars_per_usd as a string with exactly two decimals, updated_at |

- importId is a ULID, so IMP# items sort by time. date is YYYY-MM-DD. id is the existing 16-hex row id.
- Text attributes are stored as imported; every reader treats them as untrusted text.

### Import record
- Fields: import_id, source (mercadopago, notion, excel, csv), file_name, s3_key, size, period, status, created_at, expires_at, finished_at, content_hash (the existing batch id), replaces (import id or none), undo_of (import id or none), counts {added, updated, removed, skipped}, skipped (at most 200 entries of {where, reason}; skipped_truncated true when more), checks (the importer's own check object), error {code, message}.
- Statuses and moves: see States and exits.

### S3 keys
- uploads/<sub>/<importId> holds the raw file. Built only by the write handler. The parser takes person and import id from the key and checks both against the import record. When the record is missing, the parser deletes the object and writes nothing. When the event time is after expires_at, the import fails and nothing is written.

### HTTP routes
All JSON. Errors: { "error": { "code", "message" } } with codes unauthorized 401, bad_request 400, not_found 404, conflict 409, source_file_only 409, too_large 413.

| Route | Request | Response | ACs |
|---|---|---|---|
| GET /health | none, no auth | { message, stage } | none |
| POST /imports | { source, file_name, size } | 201 { import_id, upload: { url, fields }, expires_at } | AC-4, AC-6 |
| GET /imports | cursor? | { items: [{ import_id, source, file_name, period, status, created_at, finished_at, counts, active: bool }], cursor? } newest first; status is shown as stalled for an import still importing after its period's lock_until | AC-4 |
| GET /imports/{id} | none | the import record | AC-4, AC-5, AC-6 |
| POST /imports/{id}/undo | none | 202 { source, period, active_import } | AC-9 |
| POST /periods/{source}/{period}/repair | none | 202 { source, period, active_import } | AC-7, AC-8 |
| GET /transactions | from, to (yyyy-mm, at most 36 months), category?, kind?, q?, sort (date or amount), order (asc or desc), limit (1 to 200, default 50), cursor? | { items: [transaction with review choice applied, plus review: { reasons: [flag names], category_override?, approved, updated_at? }], cursor? } | AC-10, AC-14 |
| GET /totals | from, to, view (native or usd) | { months: [{ month, totals: kind, then category, then currency, to integer cents }], missing_rates: [yyyy-mm] } | AC-11, AC-16 |
| GET /review | none | { items: [transaction plus reasons: flag names] } | AC-13 |
| PUT /transactions/{id}/review | { date, category?, approved? } | 200 { review } (same shape as in GET /transactions) | AC-14, AC-15 |
| GET /rates | none | { items: [{ month, ars_per_usd }] } | AC-16 |
| PUT /rates/{month} | { ars_per_usd } | 200 { month, ars_per_usd } | AC-16 |
| GET /export | none | text/csv: the schema's columns in order, review choices applied, formula-like text neutralised | AC-17 |
| DELETE /data | { confirm: "DELETE" } | 202 { deleted: { items, files } } | AC-18 |

- POST /imports: file_name must match the source's pattern (excel needs ..._MMM_YYYY.xlsx); size at most 20 MiB for excel and 5 MiB for the others, else too_large. The form allows exactly that key and a content-length range of 1 byte to the cap, and expires in 15 minutes. S3 refuses a larger file, so no object arrives: readers show that import as expired with the reason that the file never arrived, for example because it was over the limit (AC-6).
- PUT review: the transaction must exist at TXN#date#id, else not_found; source other than mercadopago gives source_file_only (AC-15). category must be a known category; approved true clears the review reasons for that row.
- Undo: allowed only when {id} is its period's active import, else conflict (a repeat undo therefore gets conflict). It moves the pointer to the history entry before {id}, or to none, removes {id} from history, and starts a reconcile of that period.
- Repair: starts a reconcile of that period to its current active import. It is the owner's fix for a stalled import or undo.
- Cursor: opaque, encodes the offset and a hash of the query; a cursor from another query gives bad_request.
- Dollar view: usd cents = round(ars cents x 100 / rate hundredths); dollar rows pass through; a month with pesos and no rate keeps its pesos out of the dollar figure and is named in missing_rates (D-27).
- Totals: summed when read from the month's rows with review choices applied; spending is kind expense only and earnings income only (schema KINDS); the response keeps every kind so the client chooses.

### Parser input
- Import mode, from EventBridge: the Object Created event for uploads/<sub>/<importId>.
- Reconcile mode, by async invoke from undo or repair: { sub, source, period }.
- Reconcile: read the period pointer; parse the active import's file (or take an empty set when there is none); put every row of that set; delete every stored transaction of that source and period not in the set (found by a query of the person's TXN items filtered on source and period); mark the active import done; then release the lock. Running it again gives the same rows.

## Alternatives
<!-- Only for real technical forks, one table per fork under its own heading. Include the cost a reviewer would ask about. Record the chosen option as a decision in decisions.md and cite its id in the fork heading. A 1-way or stakeholder fork keeps its options in decisions.md instead. -->

### Fork: how month totals stay correct (D-14)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. Add and subtract each change from the stream | cheap per event; Lambda delivers stream records at least once, so duplicates double count without per-event bookkeeping | stream consumer | rejected |
| B. Recompute each touched month from the stream and overwrite a stored total | idempotent per run, but stream order is kept only per item, so parallel runs and retries can leave a stale total, and a late run can bring back totals after delete-all; fixing that needs versioned conditional writes and tombstones | stream consumer, on-failure queue | viable later, once a measured read cost asks for it |
| C. No stored totals; sum the asked months on every read | reads about 60 rows per month asked, a few hundred kilobytes for a year; correct by construction; no stream | none | chosen |

### Fork: getting files into the import path (D-15)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. Upload through the API body | API payload and timeout limits; files pass through a function | one route | rejected |
| B. Presigned PUT | cannot enforce a size range | URL only | rejected |
| C. Presigned POST form with exact key and size range | the client sends a multipart form | form fields in the response | chosen |

### Fork: packaging handlers with shared code (D-20)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. Raw asset of apps/api/src, runtime-provided SDK | no build step; SDK version follows the runtime; presigned POST helper may be missing | handler paths | rejected |
| B. NodejsFunction with esbuild, SDK pinned in apps/api | one dev dependency; reproducible bundles | infra props | chosen |

## States and exits
<!-- For anything with a lifecycle (jobs, sessions, retries, rollout windows): each state, how it starts, how it ends, and what happens on failure or timeout. The pre-mortem lens reviews this table. -->
| State | Entered when | Exits when | On failure or timeout |
|---|---|---|---|
| requested | POST /imports writes the import record | the parser takes the period lock and moves the import to importing in one conditional transaction (status still requested, event time before expires_at) | after expires_at with no object, readers report it expired with the reason that the file never arrived |
| importing | the move above. The lock is free, past lock_until, or held by this same import; lock_until = now + 10 minutes | parse fails: failed, nothing written, lock released. Parse succeeds with the active import's content_hash: unchanged, then reconcile. Otherwise commit (move the pointer to this import, add it to history, conditional on this import holding the lock), then reconcile: done | crash or timeout: the async retries (2) re-enter through the lock rule and redo the same step, since commit and reconcile can run twice. Retries used up: readers show stalled after lock_until; the lock then frees itself; repair, a re-upload or the next import of that period finishes the reconcile |
| unchanged | the file matches the active import's content | final, after the reconcile it still runs | as importing |
| done | reconcile finished for the active import | final; a later import, undo or repair moves the pointer | none |
| failed | parse error, size or name mismatch, a live lock held by another import, or an event after expires_at | final; the owner uploads again | none |
| ignored | an event arrives for an import that is final, or importing with a live lock held by another run | at once; nothing is written | none |
| reconciling (undo or repair) | the write handler moves the pointer (undo only) and invokes the parser in reconcile mode | the period's rows equal the active file's rows; lock released | as importing; a stalled reconcile is finished by another repair |
| erasing | DELETE /data starts | every item under P and every object under uploads/<sub>/ is gone | refused with conflict while any period lock is live or any import is requested and unexpired; a crash leaves a partial erase that a repeat call finishes |

All lock and pointer writes are conditional on lock_import being this run, so a slow duplicate cannot release or move what a later import holds.

## Cross-cutting
<!-- One short paragraph, or "none", for each: security and permissions; personal data and logs; performance and cost; deploy and infrastructure; observability; old clients. -->
- **Security and permissions:** every data route sits behind the JWT authorizer; the person comes only from the verified sub; keys are built in one module. IAM cannot scope a shared function role to one person's partition, so per-person isolation is enforced in code and proven by the second-account test (AC-3). One role per function, resource-scoped (D-21). The upload form allows one exact key and a size range.
- **Personal data and logs:** stored text and amounts never reach logs; logs carry person id hashes, import ids, counts and status. Raw uploads stay until delete-all, so undo can re-run them (D-17). Real data loads only after the budget alarm exists (D-10, release.md).
- **Performance and cost:** one partition per person with low thousands of items; list, review and totals read only the asked months' transaction and review-choice items. On-demand table, Lambda and S3 stay within small monthly cost; the account Lambda concurrency of 10 is shared by four functions with no reserved concurrency.
- **Deploy and infrastructure:** the data stack deploys before the API stack; CI deploys both per stage. The OIDC deploy role is unchanged. Creating the owner user and the second test user in each pool is a human action.
- **Observability:** import records show status, counts and skipped rows; function errors appear in the one-month log groups.
- **Old clients:** the local import keeps working on files (AC-20). The hello route moves to GET /health. The old Angular app has no link to any of this.

## Risks
<!-- Risks left after the design. Mitigation names a test, a check, or the decision that accepts the risk. At design, describe the test in words; handoff adds its id. Owner is a role. -->
| RK | Risk | Likelihood | Impact | Mitigation or acceptance | Owner |
|---|---|---|---|---|---|
| RK-1 | A handler forgets the person and reads another person's items. | low | high | Keys come only from the key module; a test runs every route as a second person against a seeded first person and expects nothing (AC-3). | engineering |
| RK-2 | A wrong period removes rows that belong to another file. | low | high | Period rules in one function with a unit test per source; reconcile only touches rows whose source and period match (D-9, D-16, D-28). | engineering |
| RK-3 | Events arrive twice, runs crash midway, or two runs overlap, leaving a period's rows unlike its active file. | medium | medium | Commit before writing and an idempotent reconcile. In-memory tests: one event delivered twice and concurrently; a crash after some puts, then a retry; a lock takeover after lock_until; a payments report correction that crashes with overlapping keys, then repair; delete-all after a stalled import (AC-7, AC-8, AC-12). | engineering |
| RK-11 | Delete-all and an import that takes its lock in the same instant can leave that import's rows behind. | low | medium | Accepted: the owner starts both; a second delete-all removes the rows. | owner |
| RK-10 | A deploy replaces the user pool or table, so new sign-in ids no longer match stored items. | low | high | The synth test of logical ids and replacement-sensitive properties fails CI first. Recovery, by a person: restore from point-in-time recovery, or re-key the partition from the old id to the new one with a one-off script. | engineering |
| RK-9 | Totals on read get slower as history grows. | low | low | The range cap of 36 months bounds one read; Epic 5 measures latency, and the stored-total option stays open (D-14). | engineering |
| RK-4 | A hostile workbook exhausts Lambda memory. | low | medium | Entry-count and total-inflate caps with a synthetic zip-bomb test (D-25). | engineering |
| RK-5 | A review choice whose row disappears after a payments report correction is left behind. | low | low | Accepted: payments report ids are stable per operation; orphaned choices are ignored on read and removed by delete-all. | owner |
| RK-6 | Admin roles of other projects in the shared account can read this data. | medium | high | Accepted in D-10. | owner |
| RK-7 | Excel amounts pass through a float before rounding to cents. | low | low | Accepted: workbook amounts have at most two decimals, and rounding of such values times 100 is exact far beyond these sizes; the local reconciliation against the Summary sheets still passes (AC-20). | engineering |
| RK-8 | The same payment imported from two sources is counted twice. | low | medium | Accepted: the three sources cover different periods; possible duplicates within the budget workbooks are flagged for a source fix (D-8). | owner |
