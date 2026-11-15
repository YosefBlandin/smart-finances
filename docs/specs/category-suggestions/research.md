---
spec: category-suggestions
ticket: none
tier: L
status: executing
---
# In-browser category suggestions with one-tap approval: research

<!-- Evidence only; the design lives in architecture.md. Read-only work: git show, git grep, read-only cloud calls. Line numbers are allowed only in this file, as path:L10-24 (repo:path:L10-24 in a multi-repo spec; no #, so drift ignores it), pinned to the refs in intent.md. Sections state corrected facts only. Examples sit in these comments. -->

## Scope
- Areas: review and approval screens, security policy and static files, categories and rules, browser model options (outside sources). Repo smart-finances at the intent.md ref.
- Produced by the spec-research workflow (4 area agents, 1 verifier re-checked 30 decision-critical facts); merged and trimmed by the planning session. Outside facts cite their source page.

## Facts
| F | Area | Fact | Evidence |
|---|---|---|---|
| - | review | The review page reads the review list once, hydrates the client cache and passes the choose and label server actions to the client island. | apps/web/src/app/(app)/review/page.tsx:L32-40 |
| - | review | The choose action takes id, date, an optional category from the shared list and an optional approved flag; at least one is required. One call may carry both, but the screen never sends both. | apps/web/src/app/(app)/review/actions.ts:L13-25; packages/contracts/src/routes.mjs:L115-118 |
| - | review | Only rows from the payments report get a category select and an Approve button; other sources show "Fix in the source". The API refuses choices on them (source_file_only). | apps/web/src/screens/review/View.tsx:L94-110; apps/api/src/store/review.mjs:L23-27 |
| - | review | Approving as is takes 1 click; changing the category and approving takes at least 3 (open select, pick, Approve). No keyboard shortcuts, no bulk approval, no suggestion exists. | apps/web/src/screens/review/View.tsx:L96-106; apps/web/src/ui/primitives/Field/Field.tsx:L141 |
| - | review | Choices are optimistic: an approved row leaves the list at once; a refused choice is undone alone and an alert shows. Choices and labels share one mutation key, and only the last to settle refetches. | apps/web/src/screens/review/Review.tsx:L41-61,L87-94; apps/web/src/screens/review/model.ts:L17-29 |
| - | review | A recipient label renames, recategorizes and approves every row with that key; on the review screen it is optimistic, on the transactions screen it waits for the server. | apps/web/src/screens/review/Review.tsx:L62-85; apps/web/src/screens/transactions/List/Container.tsx:L35-47; apps/api/src/store/labels.mjs:L17-25 |
| - | review | The transactions list shows the category as read-only text; its only write is the label control. | apps/web/src/screens/transactions/List/View.tsx:L59-70 |
| - | review | A review row carries merchant, description_raw, category (choice or label already applied), kind, amount, source, recipient_key, flags and reasons, but no approved flag. Transactions rows carry a review block with approved and category_override. | packages/contracts/src/routes.mjs:L27-43,L104-114; apps/api/src/store/query.mjs:L52-63 |
| - | review | The review list is every flagged, unapproved row in one reply, oldest first, with no paging. | apps/api/src/store/review.mjs:L11-18 |
| - | review | Transactions can be read for up to 36 months at up to 200 rows a page; the screen uses one month at 50 a page. | packages/contracts/src/routes.mjs:L93-105; apps/web/src/queries/data.ts:L96-120 |
| - | review | Every data request, choices and labels included, counts toward 120 a minute per person (5 under the test stage). | apps/web/src/domain/limits.ts:L34-35 |
| - | review | Callers of the choose and label paths: review page and island, transactions page and list, label form, the review and label use cases, the HTTP and memory data adapters, the API write handler and store, the e2e review spec, unit tests and stories. Readers of the review list: app layout count, overview page and its waiting list, review page, data route. | apps/web/src/app/(app)/review/page.tsx:L8-40; apps/web/src/app/(app)/transactions/page.tsx:L12-59; apps/web/src/adapters/data-api.ts:L132-166; apps/api/src/handlers/write.mjs:L124-160; apps/web/src/app/(app)/layout.tsx:L28 |
| - | policy | The content policy is built per request in the middleware: script-src is self, a nonce and strict-dynamic, with no wasm-unsafe-eval; there is no worker-src or child-src, so workers fall under script-src. | apps/web/src/middleware.ts:L45-65 |
| - | policy | connect-src allows only self, the upload host, the monitoring dataplane and the identity endpoint, so model files from any outside host are blocked. | apps/web/src/middleware.ts:L38-59 |
| - | policy | No cross-origin isolation headers are set anywhere, so only single-thread WebAssembly could run. | apps/web/src/middleware.ts:L72-82 |
| - | policy | The middleware runs on every path except built assets, the image route and the favicon; signed-in routes get no-store. | apps/web/src/middleware.ts:L7-10,L80,L108-110 |
| - | policy | There is no public folder and next.config sets no headers or WebAssembly options; Amplify deploys the built app with no custom header file. | apps/web/next.config.ts:L8-16; apps/web/amplify.yml:L4-30; infra/lib/web-stack.ts:L422-458 |
| - | policy | A policy change must update the exact-string unit test, the e2e test that fails on any script violation, and the post-deploy regex check run by the deploy workflow. | apps/web/src/middleware.test.ts:L23-120; apps/web/e2e/headers.spec.ts:L60-106; scripts/amplify-release.mjs:L43-81 |
| - | policy | The web-ui contract says nothing beyond the session cookie is written to browser storage. | docs/specs/web-ui/architecture.md:L224-231 |
| - | policy | Lighthouse CI fails a money page whose script exceeds 204800 bytes; the review page is one of six measured pages. | apps/web/lighthouserc.json:L1-32 |
| - | policy | No web code uses a Worker or WebAssembly; the proof-of-work field avoids a worker so the policy needs nothing new (decision 57 of the web-ui spec). | apps/web/src/ui/PowField.tsx:L1-5 |
| - | policy | Threat model v4 has no asset for a downloaded model or browser inference; its model assets assume a server-side paid model. B1 relies on the nonce policy without eval. Merchant names are untrusted text (AC2, AC8). Supply chain row LLM03 has only the lockfile done. | docs/threat-model.md:L15-56,L65,L138 |
| - | policy | The next free ADR number is 0011 (0005 is reserved). | docs/adr/README.md:L3-17 |
| - | policy | The deprecated Angular app on Vercel has Git deploys turned off and no headers; it is not a client of these screens. | vercel.json |
| - | rules | The shared category list has 25 English ids, Uncategorized last; Shopping, Pets, Interest, Refunds and Loans have no translation key, so Spanish shows the English id. | packages/contracts/src/categories.mjs:L4-31; apps/web/messages/es.json:L322-343; apps/web/src/screens/overview/text.ts:L28-34 |
| - | rules | Categories are set at import time only: Notion label regexes (17), the payments category-code map (16 categories) and whole-word brand rules (12 categories), code before name. At read time only choices and labels apply. | apps/api/src/ingest/categories.mjs:L7-31; apps/api/src/ingest/merchants.mjs:L9-56; apps/api/src/handlers/parser.mjs:L6-24 |
| - | rules | Both rule modules are pure regex and lookup code whose only import is the browser-safe contracts list. | apps/api/src/ingest/merchants.mjs:L5-61; packages/contracts/package.json |
| - | rules | A payments expense is flagged for review only when its file has the enrichment columns and it stays Uncategorized; every payout and inflow is always flagged. | apps/api/src/ingest/mercadopago.mjs:L61-79 |
| - | rules | A payments row's matchable text is its merchant (from sync, may be empty, up to 80 characters); description_raw holds technical tokens only. | apps/api/src/ingest/mercadopago.mjs:L136-154; scripts/mercadopago-sync.mjs:L190-201 |
| - | rules | The web fixture has 64 review rows over 12 months (3 to 7 a month; 26 payments, 23 notes, 15 workbook), 62 with an empty merchant; the memory adapter adds 8 hostile rows. | apps/web/fixtures/sample.json; apps/web/src/adapters/memory/data-api.ts:L40-50 |
| - | rules | Synthetic ground truth exists, but its category names differ from the shared list, so a mapping is needed to measure accuracy. | data/synthetic/generate.mjs:L37-93 |
| - | model | multilingual-e5-small: MIT, 384 dimensions, Spanish MassiveIntent 66.3; int8 ONNX is 118 MB plus a 17.1 MB tokenizer. Source: huggingface.co/intfloat/multilingual-e5-small and huggingface.co/Xenova/multilingual-e5-small | outside source |
| - | model | paraphrase-multilingual-MiniLM-L12-v2: Apache-2.0, 384 dimensions, 50 languages; int8 ONNX is 118 MB. Source: huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2 | outside source |
| - | model | gte-multilingual-base (Apache-2.0, int8 340 MB) and embeddinggemma-300m (Gemma licence, q4 197 MB) are larger. Source: their Hugging Face model cards | outside source |
| - | model | Static multilingual models need no neural runtime: static-similarity-mrl-multilingual-v1 (Apache-2.0, 51 languages, a 105,879 by 1024 table, claimed 100 to 400 times faster than e5-small at 86.5% of its classification score); potion-multilingual-128M (MIT, 256 dimensions). Source: their Hugging Face model cards | outside source |
| - | model | transformers.js 4.x (Apache-2.0) is about 456 kB of script; by default it loads its WebAssembly from a public CDN unless wasmPaths is set, and it caches in the browser unless turned off; allowRemoteModels false plus localModelPath keeps models on the app's origin. Source: huggingface.co/docs/transformers.js/api/env | outside source |
| - | model | onnxruntime-web (MIT): the plain WebAssembly file is 14.8 MB, the JavaScript entry 53.7 kB; it runs threads only when the page is cross-origin isolated. Source: onnxruntime.ai web env flags page and its npm dist listing | outside source |
| - | model | Under a content policy, WebAssembly needs wasm-unsafe-eval in script-src (Chrome and Edge 97, Firefox 102, Safari 16). Source: MDN script-src page | outside source |

## Corrections
| # | Earlier claim | Resolved fact | Evidence |
|---|---|---|---|
| 1 | The planning session told the owner a suitable model is 25 to 50 MB. | Multilingual transformer models with Spanish support are about 118 MB int8, plus a 15 MB WebAssembly runtime; only static models might fit near that size, unmeasured. | model facts above |
| 2 | The label control is never optimistic. | It is optimistic on the review screen and waits for the server on the transactions screen. | apps/web/src/screens/review/Review.tsx:L62-85 |
| 3 | Worker scripts fall back to default-src. | They fall under script-src, because script-src is present. | apps/web/src/middleware.ts:L53-64 |

## Assumptions
| Assumption | Importance | Evidence | Next step |
|---|---|---|---|
| Sending category and approved in one choose call gives a one-tap accept with no API change. | high | high | Task: a unit test with the memory data API. |
| The import rules can run unchanged in the browser. | high | high | Task: import both rule modules in a web unit test, or move them to the contracts package. |
| Review rows that reach the list are mostly ones the rules could not match, so their merchants are empty or unusual. | high | medium | Q-4 (a count, no names). |
| A worker started from a nonced script loads from self under strict-dynamic in Chrome, Firefox and Safari. Sources disagree. | high | low | Task: an e2e probe under the real policy in all three engines. |
| A worker served from built assets gets no page policy. | high | medium | Task: check worker response headers on a local production build. |
| Embedding about 100 short strings with e5-small on single-thread WebAssembly takes 1 to 3 s on a laptop (extrapolated). | high | low | Task: benchmark on a laptop and a mid-range phone with synthetic strings. |
| Amplify compute can serve a 118 MB file and cache it. | high | low | Live check 1 and a documentation check of Amplify limits. |
| A runtime loaded in a worker does not count against the 200 KiB script budget. | medium | low | Task: run Lighthouse CI on the review page with a stub worker. |
| A whole history fits in a few 200-row pages. | medium | low | Q-4. |

## Unknowns
| Unknown | Impact | Goes to |
|---|---|---|
| Which approach is worth its size: rules and history only, a static model without WebAssembly, or a transformer model with WebAssembly. | high | Q-1 |
| Whether the model file may be kept in browser storage, given the contract that nothing else is stored. | high | Q-2 |
| Which review rows get suggestions: payments expenses only, all payments rows, or all sources (needs the API to accept choices on notes and workbook rows). | high | Q-3 |
| How many rows a typical month puts on the review list, and how many have a merchant. | high | Q-4 |
| Whether rows categorized by the importer count as examples to learn from, or only rows the owner approved or labelled. | medium | Q-5 |
| Static model size after cutting dimensions and quantizing, and its accuracy on synthetic Spanish shop names. | high | task |
| Single-thread speed of each candidate on a phone. | high | task |
| Whether WebAssembly can be confined to a worker so pages keep their current policy. | high | task |
| How the threat model names the new asset and boundary (a v5 revision). | high | task |
| Headers Amplify adds on qa to built assets and to paths outside the middleware. | high | live check 1 |
| Where possible_duplicate is set and how often. | low | task |

## Live checks
| # | Check | Command or steps | Result | Date |
|---|---|---|---|---|
| 1 | Headers on a built asset and on a page on qa, and crossOriginIsolated on a signed-in page | owner, or the agent in the built-in browser with the owner's sign-in (D-4): read response headers of one built script and of the overview page; read crossOriginIsolated in the console | not run yet | |

## Resolved from code
| Question | Answer | Evidence |
|---|---|---|
| Is there a category code separate from the name? | No; the id is the English name, translated for display. | packages/contracts/src/categories.mjs:L4-31 |
| Does picking a category also approve the row? | No; the row stays until Approve. | apps/api/src/store/review.mjs:L31-37 |
| Is the review list paged? | No; one reply. | apps/api/src/handlers/read.mjs:L124-127 |
| Can WebAssembly run under today's policy? | No; script-src lacks wasm-unsafe-eval. | apps/web/src/middleware.ts:L55 |
| Can multi-threaded WebAssembly run? | No; the page is not cross-origin isolated. | apps/web/src/middleware.ts:L72-82 |
| Can the browser fetch a model from Hugging Face or a CDN? | No; connect-src blocks it. | apps/web/src/middleware.ts:L47-59 |
| Do category rules run in the browser today? | No; only at import, on the server. | apps/api/src/store/query.mjs:L52-63 |
| Is there a script size budget? | Yes; 204800 bytes on six money pages. | apps/web/lighthouserc.json |
| What is the next ADR number? | 0011. | docs/adr/README.md:L6-17 |
