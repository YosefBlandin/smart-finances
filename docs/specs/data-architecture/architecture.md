---
spec: data-architecture
ticket: none
tier: L
status: executing
---
# Data architecture: model, store, access patterns, ingestion and auth: architecture

<!-- Design by component. Cite code as <repo>:<path>#<Symbol>, never with line numbers; the drift script checks these refs. Add (new) after a file or symbol that a task creates. Cite ACs and decisions by id and never restate them. Executors read only the sections their tasks cite, so each section must stand on its own. Examples sit in these comments. -->

## Overview
<!-- 3 to 6 lines: the shape of the change and the data flow. Add a small diagram only if it saves words. -->
A new per-stage data stack holds one DynamoDB table, one private upload bucket and one Cognito user pool (D-13). The API stack adds a JWT authorizer and five functions (D-21). Upload: the browser asks for an upload form, posts the file straight to S3, and the S3 event runs the parser, which reuses the existing importers and writes rows under the signed-in person (D-6, D-12, D-15). A stream consumer recomputes the total of each touched month from its rows and writes it only if no newer computation exists (D-14). Reads (list, review list, export) filter one person's rows in memory (D-26); totals read the stored month totals.

```
browser --JWT--> HTTP API --> api-read / api-write / api-delete --> table (+ bucket for delete)
browser --form POST--> bucket --event--> parser --> table --stream--> rollup --> table (month totals)
```

## Components
<!-- One subsection per component that changes: what changes, where (<repo>:<path>#<Symbol>), which ACs and decisions it serves, and what stays the same. -->

### Data stack
- smart-finances:infra/lib/data-stack.ts#DataStack (new), wired in smart-finances:infra/bin/app.ts as smart-finances-data-stage. Serves AC-19, D-12, D-13, D-19.
- Table: on-demand, keys in Contracts "Table items", stream with keys only, point-in-time recovery on in every stage (35-day window, so erased items stay restorable that long; recorded in the threat model), deletion protection and retain-on-delete in staging and prod (D-19, D-13).
- Bucket: private, block public access, SSE-S3, enforce TLS, no versioning, CORS limited to POST from the stage's web origins, EventBridge notifications on (D-15, D-19).
- User pool: self sign-up off, users created by the owner, sign-in by email, TOTP MFA per D-18; one public app client (SRP and refresh, no secret). Retained in every stage, since the person key is the user's sub (D-13, D-6).
- Publishes table name, bucket name, pool id and client id as SSM parameters under /smart-finances/<stage>/; no CloudFormation exports, so the API stack can stop using a value without blocking a data stack deploy.
- A synth test pins the logical ids and the replacement-sensitive properties of the table (keys) and the pool (sign-in attributes), so a change that would replace either fails CI (D-13).

### API stack
- smart-finances:infra/lib/api-stack.ts#ApiStack reads the data stack's SSM parameters through a custom resource at deploy time (D-33) and builds ARNs from the names. Serves AC-1, AC-2, D-18, D-20, D-21.
- HTTP API: JWT authorizer (issuer = the pool, audience = the app client) on every route in Contracts "HTTP routes" except GET /health. The hello function moves to GET /health; the catch-all default integration is removed. Throttling stays at 10 rps, burst 20. CORS allows the stage's origins from the webOrigins map in infra/cdk.json (dev and qa: http://localhost:3000; staging and prod: empty until the web app has a host).
- Functions (NodejsFunction, Node 22, esbuild bundle with esbuild in the root package.json, one role each, one-month log group; D-20, D-21):
  - api-read: GET routes. 256 MB, 10 s. Table read only.
  - api-write: POST /imports, POST /imports/{id}/undo, POST repair, POST /totals/rebuild, PUT review, PUT rates. 256 MB, 10 s. Table read and write; s3:PutObject on the uploads/* object ARN (a presigned form acts with its signer's rights); lambda:InvokeFunction on parser and rollup.
  - api-delete: DELETE /data. 256 MB, 25 s. Table read and delete; s3:ListBucket on the bucket ARN with an s3:prefix condition of uploads/*; s3:DeleteObject on the uploads/* object ARN.
  - rollup: 512 MB, 60 s. Stream source with a filter on sort keys starting TXN# or OVR# (the handler also ignores other keys), batch 100, parallelization 1, bisect on error, 3 retries, record age up to 1 hour, on-failure SQS queue with 14-day retention and a CloudWatch alarm on its depth above 0 that publishes to an SNS topic (the owner subscribes an email); also invoked async by the rebuild route. Table read and write.
  - parser: 1024 MB, 5 minutes (below the 10-minute lock). Triggered by an EventBridge rule in the API stack for Object Created in the bucket under uploads/, and by async invoke for undo. Async retries stay at the default 2; no on-failure destination. s3:GetObject and s3:DeleteObject on the uploads/* object ARN; table read and write.
- No function gets a wildcard resource, except dynamodb:ListStreams on the rollup role (D-34).

### Handlers
- smart-finances:apps/api/src/handlers/ (new): read.mjs, write.mjs, delete.mjs, parser.mjs, rollup.mjs. Each is a thin adapter: it reads the person from the verified claims (Contracts "Identity"), validates input, and calls the core below. Serves AC-1 to AC-18.
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
- docs/adr/0004-access-patterns.md (new): keys, stores and retention, the access-pattern table and the rollup write rule (D-6, D-12, D-13, D-14, D-26, D-29); it fills in what ADR 0003 deferred. docs/adr/0006-imports-source-of-record.md (new): D-8, D-9, D-16, D-17, D-28. docs/adr/0007-shared-account.md (new): D-10. docs/adr/README.md lists them.
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
| Review choice | P | OVR#<date>#<id> | date, month, category (optional), approved (bool), updated_at; payments report rows only (D-8) |
| Import | P | IMP#<importId> | see "Import record" |
| Period pointer | P | PER#<source>#<period> | active_import, history (import ids of the files that counted, oldest first, no repeats, no cap), lock_import, lock_until |
| Rate | P | RATE#<yyyy-mm> | ars_per_usd as a string with exactly two decimals, updated_at |
| Month total | P | SUM#<yyyy-mm> | totals: kind, then category, then currency, to integer cents; row_count; computed_at (ms epoch of the consistent read it came from). row_count 0 is a tombstone that readers skip |
| Erase marker | P | ERASED | erased_at, quiet_until (unset while erasing; set to the erase's end plus 65 minutes when it finishes). Never removed, so late background work cannot bring data back |

- importId is a ULID, so IMP# items sort by time. date is YYYY-MM-DD. id is the existing 16-hex row id.
- Text attributes are stored as imported; every reader treats them as untrusted text.

### Import record
- Fields: import_id, kind (file, undo or repair), source (mercadopago, notion, excel, csv), file_name, s3_key, size, period, status, created_at, expires_at, finished_at, content_hash (the existing batch id), replaces (import id or none), undo_of (import id or none), period_target (for undo and repair: the import the pointer names), counts {added, updated, removed, skipped}, skipped (every skipped row as {where, reason}; a file with more than 2,000 unreadable rows fails as a whole, AC-6), checks (the importer's own check object), error {code, message}.
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
| POST /imports/{id}/undo | none | 202 { import_id } of the undo record | AC-9 |
| POST /periods/{source}/{period}/repair | none | 202 { import_id } of the repair record | AC-7, AC-8 |
| GET /transactions | from, to (yyyy-mm, at most 36 months), category?, kind?, q?, sort (date or amount), order (asc or desc), limit (1 to 200, default 50), cursor? | { items: [transaction with review choice applied, plus review: { reasons: [flag names], category_override?, approved, updated_at? }], cursor? } | AC-10, AC-14 |
| GET /totals | from, to, view (native or usd) | { months: [{ month, totals: kind, then category, then currency, to integer cents }], missing_rates: [yyyy-mm] } | AC-11, AC-16 |
| GET /review | none | { items: [transaction plus reasons: flag names] } | AC-13 |
| PUT /transactions/{id}/review | { date, category?, approved? } | 200 { review } (same shape as in GET /transactions) | AC-14, AC-15 |
| GET /rates | none | { items: [{ month, ars_per_usd }] } | AC-16 |
| PUT /rates/{month} | { ars_per_usd } | 200 { month, ars_per_usd } | AC-16 |
| POST /totals/rebuild | none | 202 { months: count } | AC-11, AC-12 |
| GET /export | none | text/csv: the schema's columns in order, review choices applied, formula-like text neutralised | AC-17 |
| DELETE /data | { confirm: "DELETE" } | 202 { deleted: { items, files } } | AC-18 |

- POST /imports: file_name must match the source's pattern (excel needs ..._MMM_YYYY.xlsx); size at most 20 MiB for excel and 5 MiB for the others, else too_large. The form allows exactly that key and a content-length range of 1 byte to the cap, and expires in 15 minutes. S3 refuses a larger file, so no object arrives: readers show that import as expired with the reason that the file never arrived, for example because it was over the limit (AC-6).
- PUT review: the transaction must exist at TXN#date#id, else not_found; the choice is stored at OVR#date#id; source other than mercadopago gives source_file_only (AC-15). category must be a known category; approved true clears the review reasons for that row.
- Undo: allowed only when {id} is its period's active import, else conflict (a repeat undo therefore gets conflict). The write handler creates an import record of kind undo, takes the period lock for it (conflict when live, erase check as in Rollup), moves the pointer to the history entry before {id}, or to none, removes {id} from history, and invokes the parser in reconcile mode with that record.
- Repair: the same, with kind repair and no pointer move. It is the owner's fix for a stalled import, undo or repair.
- Undo and repair records show in GET /imports with the same statuses as file imports.
- Rebuild: invokes the rollup for every month that has transactions or a stored total. It is the owner's fix for a batch that reached the on-failure queue.
- Cursor: opaque, encodes the offset and a hash of the query; a cursor from another query gives bad_request.
- Dollar view: usd cents = round(ars cents x 100 / rate hundredths); dollar rows pass through; a month with pesos and no rate keeps its pesos out of the dollar figure and is named in missing_rates (D-27).
- Totals: read from the stored month totals (tombstones skipped); a month's total sums its rows with review choices applied; spending is kind expense only and earnings income only (schema KINDS); the response keeps every kind so the client chooses.

### Parser input
- Import mode, from EventBridge: the Object Created event for uploads/<sub>/<importId>.
- Reconcile mode, by async invoke from undo or repair: { sub, import_id } of the undo or repair record, which already holds the lock.
- Reconcile: read the period pointer; parse the active import's file (or take an empty set when there is none); put every row of that set; delete every stored transaction of that source and period not in the set (found per D-32: for a one-month period, a query of TXN#<yyyy-mm> filtered on source; for a log period, a query of all TXN items filtered on source and period); mark the active import and the running record done, mark any earlier import of that period still requested or importing as superseded; then release the lock. Running it again gives the same rows.

### Rollup
- Input: stream records (keys only) or { sub, months: "all" } from rebuild. Each TXN or OVR key gives a person and a month.
- For each person and month: t = now in ms; consistent-read query of TXN#<month> and OVR#<month> items; sum by kind, category (review choice applied) and currency; then one transaction: a condition check that ERASED is absent or t > its quiet_until, and a put of SUM#<month> with the condition that it is absent or its computed_at < t. A failed condition means newer data or an erase already won and is not an error. An empty month writes a tombstone the same way.
- Erase window: from erased_at until quiet_until, rollups write nothing, and imports, undo and repair are refused with conflict. quiet_until is 65 minutes after the erase ends, longer than the stream source's 1-hour record age, so no record of the erased rows can still be processed after it.
- The parser's lock write, and the undo and repair lock writes, carry the same erase check.

## Alternatives
<!-- Only for real technical forks, one table per fork under its own heading. Include the cost a reviewer would ask about. Record the chosen option as a decision in decisions.md and cite its id in the fork heading. A 1-way or stakeholder fork keeps its options in decisions.md instead. -->

### Fork: how month totals stay correct (D-14)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. Add and subtract each change from the stream | cheap per event; Lambda delivers stream records at least once, so duplicates double count without per-event bookkeeping | stream consumer | rejected |
| B. Recompute each touched month from the stream; write only if no newer read won; tombstones and an erase marker | one consistent query of about 60 rows per touched month; correct under duplicates, retries and parallel runs; keeps the plan's Streams goal (E2.5) | stream consumer, on-failure queue, rebuild route | chosen by the owner |
| C. No stored totals; sum the asked months on every read | simplest and correct by construction; drops the Streams goal | none | rejected by the owner at DP3 |

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
| requested | POST /imports writes the import record | the parser takes the period lock and moves the import to importing in one conditional transaction (status still requested, event time before expires_at, erase check) | after expires_at with no object, readers report it expired with the reason that the file never arrived |
| importing | the move above. The lock is free, past lock_until, or held by this same record; lock_until = now + 10 minutes | parse fails: failed, nothing written, lock released. Same content_hash as the active import: unchanged, then reconcile. Otherwise commit, conditional on holding the lock and on the active import's id sorting before this one (else superseded, lock released), then reconcile: done | crash or timeout: the async retries (2) re-enter through the lock rule and redo the same step. Retries used up: readers show stalled after lock_until; the lock then frees itself; repair, a re-upload or the next import of that period finishes the reconcile |
| reconciling (undo or repair record) | the write handler takes the lock for the record and invokes the parser in reconcile mode | the period's rows equal the active file's rows: done | as importing; stalled after lock_until; another repair finishes it |
| unchanged | the file matches the active import's content | final, after the reconcile it still runs | as importing |
| done | reconcile finished | final; a later import, undo or repair moves on from it | none |
| superseded | a newer import of the period committed first | final; nothing of this import was committed | none |
| failed | parse error, size or name mismatch, a live lock held by another record, an event after expires_at, or the erase window | final; the owner uploads again | none |
| ignored | an event arrives for an import that is final, or importing with a live lock held by another run | at once; nothing is written | none |
| month total stale | a stream batch touches a TXN or OVR item | the rollup's conditional write lands, or loses to newer data or an erase | bisect and 3 retries, then the batch goes to the on-failure queue, whose alarm notifies the owner; a rebuild fixes the month |
| erasing | DELETE /data writes ERASED with erased_at and no quiet_until | every item under P except ERASED, and every object under uploads/<sub>/, is gone; quiet_until is set | refused with conflict while any period lock is live or any import is requested and unexpired; a crash leaves quiet_until unset, so everything stays refused until a repeat call finishes the erase |
| quiet | the erase finished | quiet_until passes; imports and totals work again | none |

All lock and pointer writes are conditional on lock_import being this record, so a slow duplicate cannot release or move what a later run holds.

## Cross-cutting
<!-- One short paragraph, or "none", for each: security and permissions; personal data and logs; performance and cost; deploy and infrastructure; observability; old clients. -->
- **Security and permissions:** every data route sits behind the JWT authorizer; the person comes only from the verified sub; keys are built in one module. IAM cannot scope a shared function role to one person's partition, so per-person isolation is enforced in code and proven by the second-account test (AC-3). One role per function, resource-scoped (D-21). The upload form allows one exact key and a size range.
- **Personal data and logs:** stored text and amounts never reach logs; logs carry person id hashes, import ids, counts and status. Raw uploads stay until delete-all, so undo can re-run them (D-17). Real data loads only after the budget alarm exists (D-10, release.md).
- **Performance and cost:** one partition per person with low thousands of items; list and review read only the asked months' items; totals read one item per month. On-demand table, Lambda and S3 stay within small monthly cost; the account Lambda concurrency of 10 is shared by five functions with no reserved concurrency.
- **Deploy and infrastructure:** the data stack deploys before the API stack; CI deploys both per stage. The OIDC deploy role is unchanged. Creating the owner user and the second test user in each pool is a human action.
- **Observability:** import records show status, counts and skipped rows; the rollup's on-failure queue holds failed batches for 14 days, its alarm emails the owner, and the rebuild route repairs them; function errors appear in the one-month log groups.
- **Old clients:** the local import keeps working on files (AC-20). The hello route moves to GET /health. The old Angular app has no link to any of this.

## Risks
<!-- Risks left after the design. Mitigation names a test, a check, or the decision that accepts the risk. At design, describe the test in words; handoff adds its id. Owner is a role. -->
| RK | Risk | Likelihood | Impact | Mitigation or acceptance | Owner |
|---|---|---|---|---|---|
| RK-1 | A handler forgets the person and reads another person's items. | low | high | Keys come only from the key module; a test runs every route as a second person against a seeded first person and expects nothing (AC-3): T-AUTH-3, T-KEY-1. | engineering |
| RK-2 | A wrong period removes rows that belong to another file. | low | high | Period rules in one function with a unit test per source; reconcile only touches rows whose source and period match (D-9, D-16, D-28): T-IMP-1, T-REC-3. | engineering |
| RK-3 | Events arrive twice, runs crash midway, or two runs overlap, leaving a period's rows unlike its active file. | medium | medium | Commit before writing, ordered commits and an idempotent reconcile, with undo and repair under the same lock. In-memory tests: a late retry of an older import after a newer one committed; repair overlapping an import; delete-all during a repair; one event delivered twice and concurrently; a crash after some puts, then a retry; a lock takeover after lock_until; a payments report correction that crashes with overlapping keys, then repair; delete-all after a stalled import; a rollup batch delivered twice, two rollups interleaved, and a stale rollup after an erase; rollups from the erase's own deletions; after the quiet window only ERASED remains (AC-7, AC-8, AC-12, AC-18). A synth test checks the queue alarm. Tests: T-REC-4, T-REC-5, T-REC-6, T-ROL-2, T-ROL-3, T-ERA-1, T-ERA-2, T-ERA-3, T-INF-12. | engineering |
| RK-10 | A deploy replaces the user pool or table, so new sign-in ids no longer match stored items. | low | high | The synth test of logical ids and replacement-sensitive properties fails CI first (T-INF-5). Recovery, by a person: restore from point-in-time recovery, or re-key the partition from the old id to the new one with a one-off script. | engineering |
| RK-9 | Two rollup runs on hosts with skewed clocks could let an older read win. | low | low | Accepted: Lambda hosts sync time to the millisecond range; any later change or a rebuild recomputes the month. | engineering |
| RK-4 | A hostile workbook exhausts Lambda memory. | low | medium | Entry-count and total-inflate caps with a synthetic zip-bomb test (D-25): T-IMP-3. | engineering |
| RK-5 | A review choice whose row disappears after a payments report correction is left behind. | low | low | Accepted: payments report ids are stable per operation; orphaned choices are ignored on read and removed by delete-all. | owner |
| RK-6 | Admin roles of other projects in the shared account can read this data. | medium | high | Accepted in D-10. | owner |
| RK-7 | Excel amounts pass through a float before rounding to cents. | low | low | Accepted: workbook amounts have at most two decimals, and rounding of such values times 100 is exact far beyond these sizes; the local reconciliation against the Summary sheets still passes (AC-20). | engineering |
| RK-8 | The same payment imported from two sources is counted twice. | low | medium | Accepted: the three sources cover different periods; possible duplicates within the budget workbooks are flagged for a source fix (D-8). | owner |
| RK-11 | Reconcile of a log period (notes log, generic CSV) reads every stored transaction, so its cost grows with history. | high | low | Accepted (D-32). Trigger: a log-period import reads more than 20,000 items. Fix then: a sparse index keyed U#<sub>#<source>#<period> on transaction items, keys only, with a base-table re-check because the index is eventually consistent. Month periods already read one month (T-REC-7). | engineering |
| RK-12 | List, search, review and export read the whole asked range and page by offset, so each page costs the whole range. | medium | low | Accepted (D-26, D-32). Trigger: a person holds more than 20,000 transactions, or a list page exceeds 1 second. Fix then: keyset paging on the sort key for the default date order; amount sort and text search keep the in-memory path. | engineering |
| RK-13 | Delete-all and export run inside one API request (25 s function, 30 s API limit, 6 MB response). | medium | medium | Accepted (D-32). Trigger: more than 30,000 transactions, or a delete-all or export above 15 seconds. Fix then: async jobs; export writes a short-lived private file under exports/<sub>/ and returns a presigned link, covered by delete-all. A repeat delete-all already resumes an unfinished erase (T-ERA-3). | engineering |
