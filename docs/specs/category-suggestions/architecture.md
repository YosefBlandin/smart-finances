---
spec: category-suggestions
ticket: none
tier: L
status: draft
---
# In-browser category suggestions with one-tap approval: architecture

<!-- Design by component. Cite code as <repo>:<path>#<Symbol>, never with line numbers; the drift script checks these refs. Add (new) after a file or symbol that a task creates. Cite ACs and decisions by id and never restate them. Executors read only the sections their tasks cite, so each section must stand on its own. -->

## Overview
The review island reads the person's last 12 months of rows once per visit through the existing transactions data route (D-16).
It builds an in-memory example index: recipient key or cleaned shop name, then category, each marked as the owner's or the rules' (D-11).
A pure suggest module ranks the categories for each payments row on the list. It checks, in order, the same recipient key, the same cleaned name, the import rules (moved into the shared contracts package, D-15), shared words and, last, the optional static model (D-17, D-22).
Each row shows the suggestion plus up to two other likely categories as buttons. A tap sends the existing choose action with the category and the approval together (D-19).
Accept all confirms first, then sends the same action for every suggested row, 4 at a time, and asks for the list once at the end (D-20).
Every choice made on the page is added to the in-memory index, so the other rows' suggestions update at once (AC-11). Nothing is stored and nothing new is sent (D-21, AC-13, AC-14).

```
review page (server) ── GET /review ──────────────────► island rows (unchanged)
island ── useHistory: 4 × GET /api/data/transactions ─► examples ─┐
contracts/rules (merchantCategory) ───────────────────────────────┼─► suggest(rows, index) ─► chips, Accept all
model file (built asset, optional, after idle) ─► embed() ────────┘
chip tap / Accept all ── chooseReview {category, approved:true} ─► API PUT review (unchanged)
```

## Components

### Shared import rules (D-15)
- What changes: the payments category-code map, the merchant name rules and their function move to `smart-finances:packages/contracts/src/rules.mjs#merchantCategory (new)`, with `CODE_CATEGORIES (new)` and `NAME_RULES (new)` beside them. The package exports them as `./rules`; see `smart-finances:packages/contracts/package.json` and Contracts, "Shared rules export".
- `smart-finances:apps/api/src/ingest/merchants.mjs#merchantCategory` becomes a re-export of the contracts copy, and so do `CODE_CATEGORIES` and `NAME_RULES`, so `smart-finances:apps/api/src/ingest/mercadopago.mjs#parseReleaseReport` and its tests stay as they are. The check that every mapped category is in the shared list moves with the rules.
- The Notion label rules (`smart-finances:apps/api/src/ingest/categories.mjs#categoryFor`) do not move: they are tuned for short notes labels, and notes rows get no suggestions (D-9).
- Serves AC-1 and AC-12 (rules are the third level, below the owner's own rows).

### History read (D-16)
- `smart-finances:apps/web/src/queries/data.ts#useHistory (new)` reads `GET /api/data/transactions` (route `smart-finances:apps/web/src/app/api/data/transactions/route.ts#GET`, unchanged) for the 12 months ending with the current month. It makes four parallel 3-month reads with `limit=200`, follows each read's cursor for at most 3 pages, and merges the results.
- Its key is `smart-finances:apps/web/src/queries/keys.ts#dataKeys` `.history() (new)` = `['data', 'history']`. That key is outside the `transactions`, `totals` and `review` keys, so `smart-finances:apps/web/src/screens/review/Review.tsx#Review` settle does not refetch it. `staleTime: Infinity`, `retry: 1`, and no refetch on focus or reconnect.
- The page's server render does not read history. `router.refresh()` after every save re-runs the server page, so a server-side history read would repeat on every save and spend the request limit (research fact on the person limit).
- Reply rows are parsed with the existing `GET /transactions` schema in `smart-finances:packages/contracts/src/routes.mjs#ROUTES` and reduced at once to examples (Contracts, "Suggest module"). The raw rows are not kept in the query cache: the query function returns the examples.
- Serves AC-1, AC-11, AC-12 and AC-15.

### Suggest module (D-17, D-18)
- `smart-finances:apps/web/src/domain/suggest.ts (new)` is pure TypeScript with no React, no I/O and no globals. It exports `cleanName (new)`, `examplesFrom (new)`, `buildIndex (new)`, `addChoice (new)` and `suggest (new)`. The shapes are in Contracts, "Suggest module".
- `cleanName`: NFD with accents removed, lower case, and every character that is not a letter or digit turned into a space. It drops payment-processor prefixes (`mp*`, `merpago*` and `mercadopago*`) and digit-only tokens, collapses spaces, and cuts the result to 80 characters. The text is only ever compared, never shown or evaluated, so markup and instructions in a name are just words (AC-20).
- Levels, from strongest to weakest:
  1. the same recipient key;
  2. the same cleaned name;
  3. the import rules on the row's merchant;
  4. shared words: Jaccard of at least 0.5 over tokens of 3 or more characters, with a stop-word list (for example `sa`, `srl`, `de`, `la`, `el`, `the`, `and`, `pago` and `compra`);
  5. the model, when ready.
- Within levels 1, 2 and 4, owner examples are ranked before rule examples. Rule examples count only when that level has no owner example. Inside each group the most frequent category wins, then the most recent (AC-12, D-11).
- A row gets a `pick` only from levels 1 to 5 matching that row's own key or name. `others` are the next distinct categories from lower matches, then the owner's most used categories for the same `kind`. There are at most 2, all different from the pick. `Uncategorized` and the row's current category are never offered when that category is `Uncategorized`. A row with no pick gets no others (AC-2, AC-5).
- `suggest` covers only rows whose `source` is `smart-finances:apps/web/src/screens/review/View.tsx#CHOICE_SOURCE` (D-9).
- Serves AC-1, AC-2, AC-5, AC-11, AC-12, AC-15 and AC-20.

### Review island and view
- `smart-finances:apps/web/src/screens/review/Review.tsx#Review` gains:
  - the history query;
  - `useSuggestions (new)` (in `smart-finances:apps/web/src/screens/review/suggest/useSuggestions.ts (new)`), which keeps the session's choices in React state, adds each saved or optimistic choice and each label through `addChoice`, and computes `suggest` with `useMemo`;
  - the Accept all runner (below).
  A refused single choice also removes its session example (AC-11).
- Suggestions show only once the history query has settled, whether ready or failed. Until then, payments rows keep the chip area's height as an empty, `aria-hidden` placeholder, so nothing shifts or changes under a finger (CLS budget, AC-16). If the history read fails, suggestions use rules and the model only, and the screen says nothing more: the list works as today.
- `smart-finances:apps/web/src/screens/review/View.tsx#ReviewView` gains `smart-finances:apps/web/src/screens/review/suggest/Chips.tsx#SuggestionChips (new)` above the existing picker and Approve in the action cell. The first chip is the pick. Each chip is a button named "Accept {category}" or "Use {category}" through translated messages, with the category's translated name (AC-19). The picker and Approve stay for every payments row (AC-5).
- Keyboard (AC-10): each payments row is a roving tab stop (`tabIndex` 0 on the focused row, −1 on the others). On the row element only, Enter is the pick, 1 to 3 are the chips and Up and Down move focus. Keys inside the picker, the chips or the label form do their usual job. The row has `aria-keyshortcuts`. When a row leaves the list, focus moves to the next row, or to the heading when none is left.
- Accept all: `smart-finances:apps/web/src/screens/review/suggest/AcceptAll.tsx#AcceptAll (new)` sits above the table when at least one row has a pick.
  - Its first tap opens an inline confirmation (not a dialog). It shows the count and a per-category tally from a snapshot taken at that tap, with Save and Cancel (AC-6).
  - Save runs the snapshot only. Model suggestions that arrive later are not added.
  - Labels and copy go in `smart-finances:apps/web/messages/en.json` and `smart-finances:apps/web/messages/es.json` under `review.suggest` (new). The same files gain the missing Spanish category names for Shopping, Pets, Interest, Refunds and Loans (AC-19).
- Accept all runner (D-20): a third `useMutation` with the shared `smart-finances:apps/web/src/screens/review/Review.tsx#MUTATION` key.
  - `onMutate` applies every snapshot choice at once with `smart-finances:apps/web/src/screens/review/model.ts#applyChoices (new)`.
  - `mutationFn` calls `choose` for each row, 4 at a time. A result with `retryAfterSeconds` of 60 or less is retried once after that wait. The function returns the ids that failed.
  - Each failed id is undone with `smart-finances:apps/web/src/screens/review/model.ts#undoChoice`, which puts the row back with its suggestion. A Note shows `review.suggest.someFailed` with the count (AC-8).
  - `onSettled` calls the existing settle once.
  - The single-choice and label buttons are disabled while it runs. `ChooseResult` gains `retryAfterSeconds?: number`, and the page passes the action's value through (Contracts, "Choose with category and approval").
- Serves AC-3, AC-4, AC-6 to AC-11, AC-16 and AC-19.

### Static model (gated; D-7, D-12, D-22, D-23)
- This component ships only if the measurement task meets the bar. It is built in this order:
  1. a converter, `smart-finances:scripts/suggest-model.mjs (new)`;
  2. an evaluation set, `smart-finances:apps/web/fixtures/suggest-eval.json (new)`, written and committed before any model run;
  3. a measuring test, `smart-finances:apps/web/src/domain/suggest-model.eval.test.ts (new)`;
  4. the loader, `smart-finances:apps/web/src/screens/review/suggest/model.ts#loadModel (new)`.
- If the bar or the size fails, the loader, the asset and the converter output are not committed. The evaluation result goes in the PR body and the ADR, and the PR ships history and rules only (D-7).
- Converter: it reads a locally downloaded upstream model file, which the owner approves before the download (release.md). It keeps the `[UNK]` token and the tokens made only of Latin letters, digits and `##` pieces. It truncates the vectors to D dimensions (D ≤ 256, the smallest that meets the bar), quantizes them to int8 with a scale per token, and writes the file format in Contracts, "Model file", with a NOTICE for the Apache-2.0 licence.
- Loader:
  - It runs only on the review page, after the history query settles and the browser is idle (`requestIdleCallback`, or a 2 s timeout).
  - It fetches the file with `fetch(new URL('./suggest-model.bin', import.meta.url), { integrity })`. The build emits the file under `/_next/static/media/` with a hashed name and long cache rules (D-8). The integrity value comes from the converter.
  - It tokenizes with uncased WordPiece and embeds a name as the normalized mean of its token vectors.
  - It hands `suggest` a level-5 scorer: cosine nearest neighbours among the example names, then category prototypes made from each category's English and Spanish names.
  - Everything runs on the main thread, in chunks of 20 rows between idle callbacks: no worker and no WebAssembly (D-7).
- Evaluation set: at least 30 synthetic shop names that `merchantCategory` returns null for, with expected categories from the shared list, drawn where possible from `smart-finances:data/synthetic/generate.mjs`, plus a synthetic history of at least 40 examples. It holds no real names (public repo rule).
- Serves AC-16 and AC-17.

### Records before code
- ADR 0011 (`smart-finances:docs/adr/0011-in-browser-category-suggestions.md (new)`) records D-7, D-17 and D-22, and D-23 with its outcome (constraint "ADR rule").
- `smart-finances:docs/threat-model.md` v5:
  - the history examples held in page memory;
  - the model file as a same-origin downloaded asset, with its integrity check and supply chain row;
  - shop names as untrusted input to the suggest module (AC-20).
  (constraint "Threat model rule").

## Contracts

### Shared rules export (D-15)
- `@smart-finances/contracts/rules` (new): `merchantCategory({ code?: string, merchant?: string }): string | null`, `CODE_CATEGORIES: Record<string, string>` and `NAME_RULES: [RegExp, string][]`. It behaves exactly as the API module does at e8da84b. It is browser-safe, and its only import is `./categories.mjs`.

### Choose with category and approval (D-19)
- Existing action `smart-finances:apps/web/src/app/(app)/review/actions.ts#chooseReview`, unchanged. The island sends `{ id, date, category, approved: true }`. The schema already accepts both fields, and the API saves them in one PUT `/transactions/{id}/review` (data spec), so the row is categorized and approved together or not at all.
- `smart-finances:apps/web/src/screens/review/Review.tsx#ChooseResult` widens to `{ ok: true } | { ok: false; messageKey: string; retryAfterSeconds?: number }`. The action already returns that field.

### History read (D-16)
- Existing route `GET /api/data/transactions?from=YYYY-MM&to=YYYY-MM&limit=200[&cursor=…]`, unchanged. There are four ranges: the current month and the 2 before it, then the three earlier 3-month blocks. Each range reads at most 3 pages, so a visit makes at most 12 counted requests.

### Suggest module (D-17, D-18)
```ts
type Example = { key: string; name: string; category: string; owner: boolean; kind: string; date: string };
// examplesFrom(rows): rows with category ≠ Uncategorized and a non-empty recipient_key or merchant.
// owner = review.approved || review.category_override !== undefined; name = cleanName(merchant).
type Index = { byKey: Map<string, Example[]>; byName: Map<string, Example[]>; byToken: Map<string, Example[]>; byKind: Map<string, Map<string, number>> };
type Level = 'key' | 'name' | 'rule' | 'words' | 'model';
type Suggestion = { pick: string; others: string[]; level: Level }; // others.length <= 2, all distinct from pick
type ModelScorer = (row: { name: string }) => { category: string; score: number }[];
function suggest(rows: ReviewRow[], index: Index, model?: ModelScorer): Map<string, Suggestion>; // keyed by row id; rows without a pick are absent
function addChoice(index: Index, row: ReviewRow, category: string): Index; // returns a new index, owner: true
```

### Model file (D-22; only if the gate passes)
- One binary: `u32` little-endian header length `H`, then `H` bytes of UTF-8 JSON, padded to 4 bytes.
  - The header JSON is `{ format: 1, upstream: "<model id>@<revision>", dims: D, tokens: string[], unk: number, lowercase: true, stripAccents: true }`.
  - After the header come `tokens.length × D` int8 values, then `tokens.length` float32 little-endian scales.
- At most 30 MB (AC-17). The converter prints its SHA-384 digest for `fetch`'s `integrity`.

### Messages (AC-19)
- New keys under `review.suggest`: `accept` ("Accept {category}"), `use` ("Use {category}"), `acceptAll` ("Accept {n} suggestions"), `confirmTitle`, `confirmLine` ("{n} as {category}"), `save`, `cancel`, `saving`, `someFailed` ("{n} didn't save. They're back on the list.") and `keys` (the screen-reader hint). Each key exists in both languages. The final wording follows the smart-finances-ui voice rules.

## Alternatives

### Fork: where history is read (D-16)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. Server page reads history and hydrates it | No extra client fetch, but `router.refresh()` after each save re-reads up to 12 pages: 60 saves would exceed 120 requests a minute | page.tsx plus hydration | rejected |
| B. Client query through the existing data route, once per visit | 4 parallel requests from the phone; suggestions wait one round trip | one hook and one key | chosen |
| C. New API route returning a compact history | One request, but a new route and new server code | API, contracts, web | rejected: no-go "no new routes" |

### Fork: how Accept all saves (D-20)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. One single-choice mutation per row | Each settle refetches and refreshes: about 60 × 3 extra requests | none | rejected: fails AC-9 |
| B. One client mutation running the existing action 4 at a time, one settle at the end | 60 counted requests plus about 3; per-row rollback kept | one mutation and a pool helper | chosen |
| C. A bulk server action calling the API in a loop | Still 60 counted API calls (the limit counts each API call in the data adapter); one long request; partial results harder to return | new action | rejected |

### Fork: where model math runs (D-22)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. Main thread in idle chunks | Static lookups and averages for 60 short names take milliseconds; the 30 MB fetch is off the main thread anyway | none | chosen |
| B. A Web Worker | Worker loading under `strict-dynamic` is untested in three engines (research assumption, low) | worker file and policy check | rejected |

## States and exits
| State | Entered when | Exits when | On failure or timeout |
|---|---|---|---|
| History loading | Review island mounts with rows | All four reads settle → History ready | A read fails after 1 retry → History failed: suggestions use rules and model only, no message, no further reads this visit |
| History ready | All reads succeeded | Page left (memory dropped) | n/a |
| Model idle | History settled and the gate shipped a model | Browser idle or 2 s → Model loading | n/a |
| Model loading | Idle callback fires | File fetched and checked → Model ready | Fetch, integrity or parse fails → Model off for this visit; no message; history and rule suggestions stay |
| Model ready | File parsed | Page left | A chunk throws → that chunk's rows keep their earlier suggestions |
| Confirming | Accept all tapped | Save → Saving; Cancel or a single choice elsewhere → closed | n/a |
| Saving | Save tapped | Every row answered → Done or Partial | A refusal with a wait of 60 s or less is retried once after the wait; any other refusal or a second refusal marks the row failed. Tab closed mid-run: rows not yet sent stay unapproved on the server and on the list next visit; each sent row is saved whole or not at all (D-19) |
| Done | All saved | Settle refetches the list once | n/a |
| Partial | At least one failed | Settle refetches; the failed rows are back with suggestions and the Note shows the count | n/a |

## Cross-cutting
- **Security and permissions:** no new route, action or permission. Every save goes through the existing guarded money action for the session's person. No script policy change and no WebAssembly (D-7). If shipped, the model file comes from the app's own origin with a build hash and a `fetch` integrity check. Shop names stay untrusted text: React renders them as text, and the suggest module only compares cleaned tokens (AC-20). The threat model v5 records the new asset and data.
- **Personal data and logs:** history examples (shop names, recipient keys and categories) live only in page memory and go when the page is left (D-21, AC-14). Nothing is written to browser storage beyond the normal HTTP cache for the model (D-8). No new log lines, analytics or RUM events, and no row text in any request beyond today's reads (AC-13).
- **Performance and cost:** at most 12 history requests a visit. Matching 60 rows against a few hundred examples is well under 50 ms. Suggestions appear after one parallel round trip (AC-15). The new script stays small: the suggest module, the chips and the rules, with the model loader as a dynamic import, keeps the review page under 204,800 bytes (AC-18). The model download of up to 30 MB happens only on the review page, after idle (D-8, AC-16).
- **Deploy and infrastructure:** one PR, nothing new in infrastructure. The API changes only by re-exporting the moved rules, with the same behaviour and tests. The web build must emit the model file as a hashed static asset; the task checks the size of the production build output against Amplify's limits.
- **Observability:** none new. A failed history or model load leaves the screen working as today.
- **Old clients:** an open tab on the old build keeps working: no API or action contract changes.

## Risks
| RK | Risk | Likelihood | Impact | Mitigation or acceptance | Owner |
|---|---|---|---|---|---|
| RK-1 | Most review rows are ones the rules and history can't place, so few rows get a suggestion at first. | high | medium | Accepted: each choice and label teaches the page at once (AC-11), and labels already cover people. The owner counts rows with a suggestion on qa after release (release.md). | owner |
| RK-2 | Accept all saves a wrong suggestion that cannot be undone. | medium | medium | The confirmation shows the per-category tally (AC-6). A pick needs a match on the row's own key or name (D-18). A later label fixes a whole shop. A unit test checks that a row with no name or key match gets no pick. | engineering |
| RK-3 | History reads plus Accept all reach the request limit. | low | medium | Caps in D-16 (12 reads) and one settle in D-20. A test sends 60 accepts against a limiter of 120 with 12 earlier reads and expects no refusal. The runner retries after a wait. | engineering |
| RK-4 | Common words ("la", "sa", "pago") make unrelated shops share a category. | medium | low | Stop words and a 3-character minimum. A unit test with synthetic names that share only stop words expects no pick. | engineering |
| RK-5 | Chips appearing late shift the layout and fail the CLS budget, or change under a finger. | medium | medium | Reserved placeholder height until history settles. Model results only fill rows with no pick. Lighthouse CI on the review page and an e2e test that a row's chips do not change once shown. | engineering |
| RK-6 | Moving the rules changes import results. | low | high | The API module becomes a re-export. Existing parser tests stay as they are, and a test checks that the API and contracts exports are the same functions. | engineering |
| RK-7 | The model file is too large for the build or Amplify's output limits, or slows every build. | medium | low | Gate task: a local production build with the file, its output size recorded. If it fails, ship without the model (D-7). | engineering |
| RK-8 | On a phone, the history round trip takes over 1 s, so AC-15 fails. | medium | low | Four parallel reads. An e2e test with 60 rows, 4× CPU slowdown and an added 300 ms on the data route measures the time until chips show. If it fails, the result is recorded and the owner decides at release. | engineering |
