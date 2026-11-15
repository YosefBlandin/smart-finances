---
spec: category-suggestions
ticket: none
tier: L
status: draft
---
# In-browser category suggestions with one-tap approval: questions

<!-- Open questions only, as decision cards. A fresh context that has not read the code drafts them, so they read plainly. At most 5 per round. Every card has options with their consequences, a recommendation and a default. -->
<!-- Plain language in Context and option lines: at most 25 words per sentence, no backticks, terms from the intent.md glossary. Default NONE means a written yes is required; use it only when Blocks names a gate. -->
<!-- When a card is answered: delete it, add a row to Answered, and record the decision in decisions.md. -->

## Send list
<!-- Who gets which cards, by role. No names or emails. Sending stays manual. Example row: | product | Q-1 | | | -->
| Owner | Questions | Sent on | Channel |
|---|---|---|---|
| owner | Q-1, Q-2, Q-3, Q-4, Q-5 | | chat |

## Open
<!-- Example card:
### Q-1 · Should page views from the mobile app be recorded?
Blocks: G-design · Default: B · Door: 2-way · Owner: product · Answer-by: 2026-11-15
Context: The web app will record each page a person opens. The mobile app is being retired.
A. Record mobile page views too: a complete history, but about one more week of work.
B. Record web page views only: ships sooner, and mobile visits leave no page-view event.  We recommend B because the mobile app is being retired.
If no answer by 2026-11-15, we build B.
-->

### Q-1 · Which kind of suggestion engine is worth its size?
Blocks: G-design · Default: B · Door: 2-way · Owner: owner · Answer-by: 2026-11-22
Context: Models that understand Spanish shop names are about 135 MB to download, not the 25 to 50 MB first estimated. Smaller static models need no WebAssembly, but nobody has measured them on shop names yet.
A. Your past choices and the existing rules only: nothing to download, no security change; new shops get no suggestion.
B. A, plus a small static model with no WebAssembly, if a test shows about 30 MB and good accuracy; no security change.
C. A, plus a full model through WebAssembly: about 135 MB the first time, a looser script policy, best on new shops.
D. Do nothing: the review list stays as it is.  We recommend B because it keeps the security policy as it is, and A is the fallback if the test fails.
If no answer by 2026-11-22, we build B.

### Q-2 · Where may the browser keep a downloaded model file?
Blocks: G-design · Default: A · Door: 2-way · Owner: owner · Answer-by: 2026-11-22
Context: The app promises to store nothing in the browser beyond the sign-in cookie. A model file holds no personal data. This only matters if Q-1 picks B or C.
A. Only in the browser's normal download cache, with long cache rules: the promise stays as it is, but the browser may drop the file.
B. In browser storage that the app manages: fewer repeat downloads, and the promise gains one exception for public files.  We recommend A because it keeps the promise unchanged and the file is cached anyway.
If no answer by 2026-11-22, we build A.

### Q-3 · Which review rows get a suggestion?
Blocks: G-design · Default: B · Door: 2-way · Owner: owner · Answer-by: 2026-11-22
Context: Today only payments report rows can be recategorized or approved. Money sent and received is always on the review list.
A. Payments report purchases only.
B. All payments report rows, including money sent and received.
C. Every source, which also needs the server to accept choices on notes and workbook rows: more work.  We recommend B because money sent and received fills much of the list and needs one tap too.
If no answer by 2026-11-22, we build B.

### Q-4 · How many rows does a typical month put on your review list?
Blocks: G-design · Default: B · Door: 2-way · Owner: owner · Answer-by: 2026-11-22
Context: The test data has 3 to 7 a month. The real number decides whether one-tap accept-all needs a new bulk save. A count is enough; no names.
A. Fewer than 20.
B. Between 20 and 60.
C. More than 60.  We assume B from the October sync, which had 129 operations.
If no answer by 2026-11-22, we design for B.

### Q-5 · Which past rows may suggestions learn from?
Blocks: G-design · Default: B · Door: 2-way · Owner: owner · Answer-by: 2026-11-22
Context: Suggestions copy the category of similar rows you already have.
A. Only rows you approved, recategorized or labelled yourself: cleaner, but few examples at first.
B. Also rows the import rules categorized: many examples from day one, with the rules' mistakes too.  We recommend B because the rules are already trusted on import, and your own choices still win.
If no answer by 2026-11-22, we build B.

## Answered
<!-- One row per answered card: question id, → the decision id, date, role. -->
| Q | Answer | Date | Who |
|---|---|---|---|
