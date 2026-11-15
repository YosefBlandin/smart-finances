---
spec: category-suggestions
ticket: none
tier: L
status: executing
---
# In-browser category suggestions with one-tap approval: architecture

<!-- Design by component. Cite code as <repo>:<path>#<Symbol>, never with line numbers; the drift script checks these refs. Add (new) after a file or symbol that a task creates. Cite ACs and decisions by id and never restate them. Executors read only the sections their tasks cite, so each section must stand on its own. -->

## Overview
The review island reads the person's last 12 months of rows once per visit through the existing transactions data route (D-24).
It builds an in-memory example index: recipient key or cleaned shop name, then category, each marked as the owner's or the rules' (D-11).
A pure suggest module ranks the categories for each payments row on the list. It checks, in order, the same recipient key, the same cleaned name, the import rules (moved into the shared contracts package, D-15), shared words and, last, the optional static model (D-17, D-22).
Each row shows the suggestion plus up to two other likely categories as buttons. A tap sends the existing choose action with the category and the approval together (D-19).
Accept all confirms first, then sends the same action for every suggested row, 4 at a time, and asks for the list once at the end (D-25).
Every choice made on the page is added to the in-memory index, so the other rows' suggestions update at once (AC-11). Nothing is stored and nothing new is sent (D-26, AC-13, AC-14).

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

### History read (D-24)
- The read starts only once the review list has loaded with at least one payments row; an empty or failed list reads no history.
- `smart-finances:apps/web/src/queries/data.ts#useHistory (new)` reads `GET /api/data/transactions` (route `smart-finances:apps/web/src/app/api/data/transactions/route.ts#GET`, unchanged) for the 12 months ending with the current month. It makes four parallel 3-month reads with `limit=200`, follows each read's cursor for at most 3 pages, and merges the results.
- It returns `{ examples: Example[]; complete: boolean }`.
- Its key is `smart-finances:apps/web/src/queries/keys.ts#dataKeys` `.history() (new)` = `['data', 'history']`. That key is outside the `transactions`, `totals` and `review` keys, so `smart-finances:apps/web/src/screens/review/Review.tsx#Review` settle does not refetch it.
- Query options: `staleTime: Infinity`, `retry: 1`, no refetch on focus or reconnect, and `gcTime: 0`. The island also removes the query when it unmounts. Every visit to the review page therefore reads history again, and that read already holds the choices saved on earlier visits (D-26).
- Each range is read and kept on its own. The query returns the merged examples with `complete: false` when any range failed after its retry. A range that reaches its 3-page cap keeps its newest 600 rows, and that still counts as complete.
- The page's server render does not read history. `router.refresh()` after every save re-runs the server page, so a server-side history read would repeat on every save and spend the request limit (research fact on the person limit).
- Reply rows are typed with the existing `GET /transactions` reply type (`TransactionsPage` in keys.ts) through `getJson`, like `useReview`, with no runtime schema parse in the browser (it would pull the route schemas into the page script), and reduced at once to examples (Contracts, "Suggest module"). The raw rows are not kept in the query cache: the query function returns the examples.
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
- `suggest` covers only rows whose `source` is `'mercadopago'`, the same value as `smart-finances:apps/web/src/screens/review/View.tsx#CHOICE_SOURCE` (D-9). The web lint rule lets `src/domain` import only domain code and the contracts package, so the module declares its own row type (Contracts) and the literal.
- Serves AC-1, AC-2, AC-5, AC-11, AC-12, AC-15 and AC-20.

### Review island and view
- `smart-finances:apps/web/src/screens/review/Review.tsx#Review` gains:
  - the history query;
  - `useSuggestions (new)` (in `smart-finances:apps/web/src/screens/review/suggest/useSuggestions.ts (new)`), which keeps the session's choices in React state, adds each saved or optimistic choice and each label through `addChoice`, and computes `suggest` with `useMemo`;
  - the Accept all runner (below).
  A refused single choice removes its session example, and so does each failed Accept all row (AC-11).
- Settle for single choices and labels is debounced. It runs 2 s after the last one settles, and the timer restarts when a new choice starts. A quick run of taps therefore costs one counted request each plus one refetch at the end, not about 4 extra requests per row (RK-9). Accept all keeps its single settle at the end.
- Suggestions show only once the history query has settled, whether ready or failed. Until then, payments rows keep the chip area's height as an empty, `aria-hidden` placeholder.
  - While a model can still arrive (the model shipped and is not yet ready or off), payments rows with no pick keep that placeholder too, so model chips fill reserved space and no row moves (CLS budget, AC-16).
  - When the model is ready or off, or none shipped, rows with no pick lose the placeholder in one change.
- If any history range fails, suggestions use what was read, plus the rules and the model, and Accept all is hidden for that visit. Single chips still show, so every save is still one the owner looked at. The screen says nothing more: the list works as today.
- UI rules from the web-ui spec's decisions 22 (chips at least 44px tall on touch screens, 32px elsewhere), 129 and 136 (Storybook states with accessibility checks), and 141 (React Aria for any popover). Stories go in `smart-finances:apps/web/src/screens/review/Review.stories.tsx` for these states, in en and es:
  - suggestions loading;
  - chips;
  - no pick;
  - confirming;
  - saving;
  - partial failure;
  - history failed (no Accept all).
- Accept all and the chips never put row text (shop names, keys) in an `Error` message or in console output. Thrown messages carry ids and counts only, because browser monitoring reports script errors.
- `smart-finances:apps/web/src/screens/review/View.tsx#ReviewView` gains `smart-finances:apps/web/src/screens/review/suggest/Chips.tsx#SuggestionChips (new)` above the existing picker and Approve in the action cell. The first chip is the pick. Each chip is a button named "Accept {category}" or "Use {category}" through translated messages, with the category's translated name (AC-19). The picker and Approve stay for every payments row (AC-5).
- Keyboard (AC-10): each payments row is a roving tab stop (`tabIndex` 0 on the focused row, −1 on the others). On the row element only, Enter is the pick, 1 to 3 are the chips and Up and Down move focus. Keys inside the picker, the chips or the label form do their usual job. The row has `aria-keyshortcuts`. When a row leaves the list, focus moves to the next row, or to the heading when none is left.
  - Key events with `repeat` set are ignored. After an Enter or digit accepts a row, the next row takes no accept key until a keyup, so holding Enter saves one row only.
  - `smart-finances:apps/web/src/ui/patterns/DataTable/DataTable.tsx#DataTable` `Row` passes through `tabIndex`, `onKeyDown`, `onKeyUp`, `aria-keyshortcuts`, `aria-label` and a ref. It gets its own test and story.
- Accept all: `smart-finances:apps/web/src/screens/review/suggest/AcceptAll.tsx#AcceptAll (new)` sits above the table when at least one row has a pick.
  - Its first tap opens an inline confirmation (not a dialog). It shows the count and a per-category tally from a snapshot taken at that tap, with Save and Cancel (AC-6).
  - Save runs the snapshot only. Model suggestions that arrive later are not added.
  - The confirmation closes, and nothing is saved, on Cancel, on any single choice or label, and on any change to the review list data.
  - Save is single-shot: the first tap closes the confirmation and starts the runner. Before sending, the runner drops snapshot rows that are no longer on the list.
  - Focus: after Save it goes to the saving line. After Cancel it returns to the Accept all button. When the run ends with nothing left, it goes to the page heading.
  - Labels and copy go in `smart-finances:apps/web/messages/en.json` and `smart-finances:apps/web/messages/es.json` under `review.suggest` (new). The same files gain the missing Spanish category names for Shopping, Pets, Interest, Refunds and Loans (AC-19).
- Accept all runner (D-25): a third `useMutation` with the shared `smart-finances:apps/web/src/screens/review/Review.tsx#MUTATION` key.
  - `onMutate` applies every snapshot choice at once with `smart-finances:apps/web/src/screens/review/model.ts#applyChoices (new)`.
  - `mutationFn` calls `choose` for each row, 4 at a time, through `smart-finances:apps/web/src/screens/review/suggest/pool.ts#saveAll (new)`.
    - Each call is wrapped on its own. A thrown or rejected call, or one with no answer after 20 s, marks that row failed, and the pool goes on.
    - A result with `retryAfterSeconds` of 60 or less is retried once after that wait. Meanwhile the saving line shows the seconds left.
    - The pool waits for every call to finish (all settled) and then returns the ids that failed. `mutationFn` never rejects.
  - While Saving, the island shows the AcceptAll saving line even when no rows are left. The empty state shows only after settle.
  - Each failed id is undone with `smart-finances:apps/web/src/screens/review/model.ts#undoChoice`, which puts the row back with its suggestion. A Note shows `review.suggest.someFailed` with the count (AC-8).
  - `onSettled` calls the existing settle once.
  - The single-choice and label buttons are disabled while it runs. `ChooseResult` gains `retryAfterSeconds?: number`, and the page passes the action's value through (Contracts, "Choose with category and approval").
- Serves AC-3, AC-4, AC-6 to AC-11, AC-16 and AC-19.

### Static model (gated; D-7, D-12, D-22, D-23)
- Not built in this PR (D-30): the owner chose not to download the upstream model. The rest of this section stays as the design for a later change; everything below about the model is inactive, and the island treats the model as "none shipped".
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
  - It hands `suggest` a level-5 scorer from `smart-finances:apps/web/src/domain/suggest-model.ts (new)`, the one home of the tokenizer, the embedding and the scorer; the evaluation test and the browser both use it. Fixed before any evaluation run:
    - neighbours: the 5 example names with the highest cosine at or above 0.5; each votes its cosine for its category, owner examples twice;
    - prototypes: each category's English and Spanish names, embedded; each category adds half its best prototype cosine;
    - a pick only when the best category scores at least 0.6; otherwise the model gives nothing for that row, so Accept all never saves a weak guess.
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

### History read (D-24)
- Existing route `GET /api/data/transactions?from=YYYY-MM&to=YYYY-MM&limit=200[&cursor=…]`, unchanged. There are four ranges: the current month and the 2 before it, then the three earlier 3-month blocks. Each range reads at most 3 pages, so a visit makes at most 12 counted requests.

### Suggest module (D-17, D-18)
```ts
type Example = { key: string; name: string; category: string; owner: boolean; kind: string; date: string };
// examplesFrom(rows): rows with category ≠ Uncategorized and a non-empty recipient_key or merchant.
// owner = review.approved || review.category_override !== undefined; name = cleanName(merchant).
type Index = { byKey: Map<string, Example[]>; byName: Map<string, Example[]>; byToken: Map<string, Example[]>; byKind: Map<string, Map<string, number>> };
type Level = 'key' | 'name' | 'rule' | 'words' | 'model';
type Suggestion = { pick: string; others: string[]; level: Level }; // others.length <= 2, all distinct from pick
type SuggestRow = { id: string; source: string; merchant: string; recipient_key: string; kind: string; category: string };
type HistoryRow = SuggestRow & { date: string; review: { approved: boolean; category_override?: string } };
type ModelScorer = (row: { name: string }) => { category: string; score: number }[];
function examplesFrom(rows: HistoryRow[]): Example[];
function suggest(rows: SuggestRow[], index: Index, model?: ModelScorer): Map<string, Suggestion>; // keyed by row id; rows without a pick are absent
function addChoice(index: Index, row: SuggestRow, category: string): Index; // returns a new index, owner: true
```

### Save pool (D-25)
```ts
type SaveResult = { ok: true } | { ok: false; messageKey: string; retryAfterSeconds?: number };
function saveAll(
  choices: { id: string; date: string; category: string; approved: true }[],
  choose: (c: { id: string; date: string; category: string; approved: true }) => Promise<SaveResult>,
  opts?: { concurrency?: number /* 4 */; timeoutMs?: number /* 20_000 */; maxRetryWaitS?: number /* 60 */; onWait?: (secondsLeft: number) => void },
): Promise<string[]>; // the failed ids; never rejects; resolves after every call settles
```

### Model file (D-22; only if the gate passes)
- One binary: `u32` little-endian header length `H`, then `H` bytes of UTF-8 JSON, padded to 4 bytes.
  - The header JSON is `{ format: 1, upstream: "<model id>@<revision>", dims: D, tokens: string[], unk: number, lowercase: true, stripAccents: true }`.
  - After the header come `tokens.length × D` int8 values, then `tokens.length` float32 little-endian scales.
- At most 30 MB (AC-17). The converter prints its SHA-384 digest for `fetch`'s `integrity`.
- Paths: the file is `apps/web/src/screens/review/suggest/suggest-model.bin` and its licence is `apps/web/src/screens/review/suggest/NOTICE-suggest-model.txt`, both new and committed only if the gate passes (D-23). The digest lives in `smart-finances:apps/web/src/screens/review/suggest/model.ts#MODEL_SHA384 (new)` as `sha384-<base64>`.
- A unit test hashes the committed file and compares the result with `MODEL_SHA384`. It also fails when the file is over 30 MB.

### Messages (AC-19)
New keys under `review.suggest`, with ICU plurals as in `overview.todoReview`. Spanish uses "tú", like the rest of es.json.

| Key | en | es |
|---|---|---|
| accept | Accept {category} | Aceptar {category} |
| use | Use {category} | Usar {category} |
| acceptAll | {n, plural, one {Accept all (# suggestion)} other {Accept all (# suggestions)}} | {n, plural, one {Aceptar todo (# sugerencia)} other {Aceptar todo (# sugerencias)}} |
| confirmTitle | Save these suggestions and approve the rows? | ¿Guardar estas sugerencias y aprobar los movimientos? |
| confirmLine | {n, plural, one {# as {category}} other {# as {category}}} | {n, plural, one {# como {category}} other {# como {category}}} |
| save | Save and approve | Guardar y aprobar |
| cancel | Cancel | Cancelar |
| saving | {n, plural, one {Saving # row…} other {Saving # rows…}} | {n, plural, one {Guardando # movimiento…} other {Guardando # movimientos…}} |
| waiting | {s, plural, one {Too many saves at once. Trying again in # second…} other {Too many saves at once. Trying again in # seconds…}} | {s, plural, one {Demasiados cambios a la vez. Reintentando en # segundo…} other {Demasiados cambios a la vez. Reintentando en # segundos…}} |
| someFailed | {n, plural, one {# row didn't save. It's back on the list.} other {# rows didn't save. They're back on the list.}} | {n, plural, one {# movimiento no se guardó. Volvió a la lista.} other {# movimientos no se guardaron. Volvieron a la lista.}} |
| keys | Enter accepts the suggestion, 1 to 3 pick one, the arrow keys move between rows. | Enter acepta la sugerencia, 1 a 3 eligen una, las flechas pasan de un movimiento a otro. |

Category names missing from both files today, under `categories`: shopping "Shopping" / "Compras", pets "Pets" / "Mascotas", interest "Interest" / "Intereses", refunds "Refunds" / "Reembolsos", loans "Loans" / "Préstamos".

## Alternatives

### Fork: where history is read (D-24)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. Server page reads history and hydrates it | No extra client fetch, but `router.refresh()` after each save re-reads up to 12 pages: 60 saves would exceed 120 requests a minute | page.tsx plus hydration | rejected |
| B. Client query through the existing data route, once per visit | 4 parallel requests from the phone; suggestions wait one round trip | one hook and one key | chosen |
| C. New API route returning a compact history | One request, but a new route and new server code | API, contracts, web | rejected: no-go "no new routes" |

### Fork: how Accept all saves (D-25)
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
| History loading | The review list has loaded with at least one payments row | All four reads settle → History ready, or History partial | A range fails after 1 retry → History partial |
| History ready | All ranges read (a range at its page cap counts as read) | Page left: the query is removed (gcTime 0) | n/a |
| History partial | At least one range failed | Page left: the query is removed | Suggestions use the ranges that were read, plus the rules and the model; Accept all is hidden this visit; no message; no further reads this visit |
| Model idle | History settled and the gate shipped a model | Browser idle or 2 s → Model loading | n/a |
| Model loading | Idle callback fires | File fetched and checked → Model ready | Fetch, integrity or parse fails → Model off for this visit; no message; history and rule suggestions stay |
| Model ready | File parsed | Page left | A chunk throws → that chunk's rows keep their earlier suggestions |
| Confirming | Accept all tapped | Save (first tap only) → Saving; Cancel, any single choice or label, or a change to the review list data → closed, nothing saved | n/a |
| Saving | Save tapped | Every call settled → Done or Partial | A refusal with a wait of 60 s or less is retried once after the wait, with the seconds shown. Any other refusal, a second refusal, a thrown call, or no answer in 20 s marks the row failed and the pool goes on. Tab closed mid-run: rows not yet sent stay unapproved on the server and on the list next visit; each sent row is saved whole or not at all (D-19) |
| Done | All saved | Settle refetches the list once | n/a |
| Partial | At least one failed | Settle refetches; the failed rows are back with suggestions and the Note shows the count | n/a |

## Cross-cutting
- **Security and permissions:** no new route, action or permission. Every save goes through the existing guarded money action for the session's person. No script policy change and no WebAssembly (D-7). If shipped, the model file comes from the app's own origin with a build hash and a `fetch` integrity check. Shop names stay untrusted text: React renders them as text, and the suggest module only compares cleaned tokens (AC-20). The threat model v5 records the new asset and data.
- **Personal data and logs:** history examples (shop names, recipient keys and categories) live only in page memory. The query is removed when the page is left (D-26, AC-14). Nothing is written to browser storage beyond the normal HTTP cache for the model (D-8). There are no new log lines, analytics or RUM events, and no row text in any request beyond today's reads (AC-13). Errors thrown by the new code carry ids and counts only, never row text, because browser monitoring reports script errors. A unit test with hostile rows checks this.
- **Tests and the test-stage limit:** under the test stage a person may make 5 data requests a minute.
  - A new E2E data mode `'suggest'` in `smart-finances:apps/web/src/adapters/container.ts#E2E_PEOPLE` seeds the shared fixtures plus `apps/web/fixtures/suggest.json` and leaves the person uncounted. `fixtureSeed` in `smart-finances:apps/web/src/adapters/memory/data-api.ts#fixtureSeed` takes the extra fixture as an optional argument (its `transactions` and `reviewRows` only); an extra row may carry `review: { approved, category_override? }`, so the history holds owner examples too; the default stays as it is. suggest.json has the same shape as sample.json (`transactions`, `reviewRows`): 60 synthetic payments review rows and 12 months of synthetic history, with made-up shop names and keys.
  - A new person `suggest` uses that mode for the e2e tests for chips, timing and Accept all.
  - Every existing person whose spec opens /review with fixture data and does not test the limit gets data `'uncounted'`. The limit people keep counting; any of them that opens /review gets `'empty'` data, so /review still makes one counted read per load (an empty list reads no history). The whole e2e suite runs before the PR.
  - Stories seed `dataKeys.history()` in their QueryClient with examples built from suggest.json by `examplesFrom`; partial and loading states seed `complete: false` or no data.
  - The limiter itself is tested in unit tests with a counting fake at 120 (RK-3, RK-9).
## Risks
| RK | Risk | Likelihood | Impact | Mitigation or acceptance | Owner |
|---|---|---|---|---|---|
| RK-1 | Most review rows are ones the rules and history can't place, so few rows get a suggestion at first. | high | medium | Accepted: each choice and label teaches the page at once (AC-11), and labels already cover people. The owner counts rows with a suggestion on qa after release (release.md). | owner |
| RK-2 | Accept all saves a wrong suggestion that cannot be undone. | medium | medium | The confirmation shows the per-category tally (AC-6). A pick needs a match on the row's own key or name (D-18). A later label fixes a whole shop. A unit test checks that a row with no name or key match gets no pick. | engineering |
| RK-3 | History reads plus Accept all reach the request limit. | low | medium | Caps in D-24 (12 reads) and one settle in D-25. A test sends 60 accepts against a limiter of 120 with 12 earlier reads and expects no refusal. The runner retries after a wait. | engineering |
| RK-4 | Common words ("la", "sa", "pago") make unrelated shops share a category. | medium | low | Stop words and a 3-character minimum. A unit test with synthetic names that share only stop words expects no pick. | engineering |
| RK-5 | Chips appearing late shift the layout and fail the CLS budget, or change under a finger. | medium | medium | Reserved placeholder height until history settles. Model results only fill rows with no pick. Lighthouse CI on the review page and an e2e test that a row's chips do not change once shown. | engineering |
| RK-6 | Moving the rules changes import results. | low | high | The API module becomes a re-export. Existing parser tests stay as they are, and a test checks that the API and contracts exports are the same functions. | engineering |
| RK-7 | The model file is too large for the build or Amplify's output limits, or slows every build. | medium | low | Gate task: a local production build with the file, its output size recorded. If it fails, ship without the model (D-7). | engineering |
| RK-9 | Fast single taps or Enter presses each run a full refetch and refresh, so a quick pass over 25 or more rows reaches 120 requests a minute. | medium | medium | Debounced settle for single choices (Review island section). A unit test with an injected limiter at 120 runs 60 single accepts in a minute and expects no refusal. | engineering |
| RK-10 | History is removed on leaving the page, so each visit costs up to 12 reads again. | high | low | Accepted: it keeps suggestions in line with saved choices (D-26). 12 reads plus 60 saves is still well under 120. | engineering |
| RK-8 | On a phone, the history round trip takes over 1 s, so AC-15 fails. | medium | low | Four parallel reads. An e2e test with 60 rows, 4× CPU slowdown and an added 300 ms on the data route measures the time until chips show. If it fails, the result is recorded and the owner decides at release. | engineering |
