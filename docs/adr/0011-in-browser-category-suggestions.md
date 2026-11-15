# 0011: In-browser category suggestions

Status: accepted, 2026-11-15

Decision ids in this record are those of the category-suggestions spec (`docs/specs/category-suggestions/decisions.md`), not of the specs that earlier ADRs cite.

## Context
Since the payments report gained shop names (ADR 0010), the review list gets about 20 to 60 rows a month, and each takes one to three clicks with nothing to help the owner choose. Most rows repeat a shop or a person the owner has already categorized. The owner asked for suggestions they can accept with one tap, from a cheap model or something like it, worked out on the device so that no transaction text goes to an outside service. The question is where the suggestions are worked out, what they are built from, and whether a model file is part of it.

## Decisions
- **D-7**: Suggestions are worked out in the browser, from the person's past rows and the existing import rules first, then a small static model with no WebAssembly, only if a measured task shows a download near 30 MB and acceptable accuracy on synthetic shop names; otherwise past rows and rules only. No transaction text leaves the browser and the script policy does not change.
- **D-8**: A model file is kept only in the browser's normal download cache, with long cache rules; the app writes nothing new to browser storage.
- **D-15**: The payments import rules (category codes and shop name rules) move to the shared contracts package; the API module re-exports them unchanged, so the browser and the importer use one copy.
- **D-17**: Suggestion levels, strongest first: same recipient key, same cleaned shop name, import rules, shared words, model; within a level the owner's own rows beat rule-categorized rows.
- **D-22**: If the model ships: a static multilingual model cut to Latin-script tokens, at most 256 dimensions, int8, as one hashed built file from the app's own address with an integrity check, loaded after idle on the review page only and run on the main thread in small chunks.
- **D-23**: If the model meets the bar, its converted file (at most 30 MB) is committed to the public repo with its licence notice.

## What it looks like
- **History.** On each visit, the review island reads the person's last 12 months through the existing transactions data route, four 3-month ranges of at most 3 pages each, and keeps only examples (cleaned shop name, recipient key, category, whether the owner chose it) in page memory. The query is removed when the page is left (D-24).
- **Suggest module.** `apps/web/src/domain/suggest.ts` is pure code: it ranks categories for each payments row by the levels of D-17 and gives one pick plus up to two other likely categories. A pick needs a match on the row's own key or name (D-18). Shop names are only compared as cleaned tokens, never shown or run.
- **Saving.** A chip sends the existing review action with the category and the approval together (D-19). Accept all confirms first and saves 4 at a time with one refetch at the end (D-25).
- **Rules.** `packages/contracts/src/rules.mjs` holds the category code map and the shop name rules; `apps/api/src/ingest/merchants.mjs` re-exports them (D-15).

## Options

### Where suggestions are worked out (D-7)
- **In the browser, from history and rules, with an optional static model** (chosen): no transaction text leaves the device and no server change; the model, if it ships, is a plain file of numbers.
- **An outside AI service**: better guesses on unknown names, but transaction text would leave for a third party, against the owner's ask.
- **A WebAssembly or worker runtime for a full model**: needs a script policy change (`wasm-unsafe-eval`) and an untested worker under the current policy, for a gain the static model may already give.

### What a model is (D-22)
- **Static embeddings, int8, Latin-script tokens, at most 256 dimensions** (chosen): a table lookup and an average per name, milliseconds for 60 rows on the main thread.
- **A transformer encoder**: tens of MB more and a runtime the script policy does not allow.

## Model gate
Pending SF-12: the evaluation on synthetic shop names that the rules miss, against the bar of D-12 (the right category among the 3 shown for at least 8 of 10, the pick for at least 6 of 10), with the size of the converted file at each tried dimension.

## Trade-offs
- At first many rows have no suggestion: history and rules only know shops seen before (RK-1). Each choice and label teaches the page at once.
- Accept all cannot be undone, so it asks first and shows a per-category tally.
- If the model ships, the file stays in git history for good, even after a revert (D-23).

## What would change the decision
- Suggestions on too few rows after a month on qa (T-MAN-1), with a model that missed the bar: revisit a larger model, which would need a new script policy decision.
- A server-side model inside the project's own AWS account becoming cheap enough to run per row.
