---
spec: data-architecture
ticket: none
tier: L
status: draft
---
# Data architecture: model, store, access patterns, ingestion and auth: questions

<!-- Open questions only, as decision cards. A fresh context that has not read the code drafts them, so they read plainly. At most 5 per round. Every card has options with their consequences, a recommendation and a default. -->
<!-- Plain language in Context and option lines: at most 25 words per sentence, no backticks, terms from the intent.md glossary. Default NONE means a written yes is required; use it only when Blocks names a gate. -->
<!-- When a card is answered: delete it, add a row to Answered, and record the decision in decisions.md. -->

## Send list
<!-- Who gets which cards, by role. No names or emails. Sending stays manual. Example row: | product | Q-1 | | | -->
| Owner | Questions | Sent on | Channel |
|---|---|---|---|
| owner | Q-1, Q-2, Q-3, Q-4, Q-5 | | |

## Open
<!-- Example card:
### Q-1 · Should page views from the mobile app be recorded?
Blocks: G-design · Default: B · Door: 2-way · Owner: product · Answer-by: 2026-10-20
Context: The web app will record each page a person opens. The mobile app is being retired.
A. Record mobile page views too: a complete history, but about one more week of work.
B. Record web page views only: ships sooner, and mobile visits leave no page-view event.  We recommend B because the mobile app is being retired.
If no answer by 2026-10-20, we build B.
-->

### Q-1 · One person only, or room for others
Blocks: G-design · Default: A · Door: 1-way · Owner: owner · Answer-by: 2026-10-27
Context: Today nothing marks which person a transaction belongs to. The plan includes a security test where a second test account must not see the first account's data.
A. Mark every stored item with the signed-in person, even with one user: small cost now. It makes the second-account test possible and lets us enforce who sees what.
B. Store items with no person marker, single user only: slightly simpler. The second-account test cannot pass, and adding people later means rewriting every stored item.  We recommend A because the test needs it and a later rewrite is costly.
If no answer by 2026-10-27, we build A.

### Q-2 · How pesos and dollars are combined in totals
Blocks: G-design · Default: B · Door: 2-way · Owner: owner · Answer-by: 2026-10-27
Context: Amounts are kept in the currency they were recorded in, and nothing is converted. Savings rate and monthly totals across sources need one currency.
A. Show separate totals per currency, with no conversion: no rate to maintain. You get no single savings rate across sources.
B. Keep original amounts and add a dollar view using one monthly rate you choose and enter, such as official or a market rate. Rates are stored apart, so changing the rate kind later only recalculates. Cost: small monthly upkeep.
C. Convert to dollars when importing and keep only dollars: simplest reports. Original amounts are lost, and any rate mistake stays baked in.  We recommend B because it gives one savings rate and keeps your original amounts.
If no answer by 2026-10-27, we build B.

### Q-3 · Where your review choices are kept
Blocks: G-design · Default: A · Door: 1-way · Owner: owner · Answer-by: 2026-10-27
Context: Importing a file again recalculates every row, including marks such as "needs review". Duplicates are flagged today but still counted in totals.
A. Keep your choices apart from imported rows and apply them on top when showing data. Choices survive re-imports, a confirmed duplicate leaves the totals, and approving only clears the review mark.
B. Write your choices straight onto the imported row: simpler. Importing the same file again silently wipes your review work.  We recommend A because it protects your review work.
If no answer by 2026-10-27, we build A.

### Q-4 · Uploading a corrected version of a file
Blocks: G-design · Default: A · Door: 1-way · Owner: owner · Answer-by: 2026-10-27
Context: An edited notes log or spreadsheet produces different rows. A newer payments report can change an amount for the same payment, and today an import cannot be undone.
A. A new file for the same source and period replaces the earlier rows from that source and period. Rows missing from the new file are removed, and review choices stay on rows that still exist. Undo means restoring the previous file.
B. Only add rows, never remove any: nothing is lost. Corrections create duplicates that you must clean up by hand.
C. Keep every version and let you choose which one counts: most control. It also means the most screens and the most work.  We recommend A because corrections replace old rows cleanly and undo stays possible.
If no answer by 2026-10-27, we build A.

### Q-5 · Where the real data lives in the cloud
Blocks: G-promote · Default: NONE · Door: 1-way · Owner: owner · Answer-by: 2026-10-27
Context: The cloud account used today also holds unrelated projects, and its deploy setup has full administrator rights. No spending budget or billing alarm exists there yet.
A. Create a separate cloud account for this project before real data is loaded, with a budget alarm: about an hour of your setup. Other projects can never touch this data.
B. Stay in the shared account and add a budget alarm now: no setup move. Anything with administrator rights there can read this data, and moving later means copying all the data.  We recommend A because real financial data should not share an account with other projects.
No default: this needs a written answer before G-promote.

## Answered
<!-- One row per answered card: question id, → the decision id, date, role. -->
| Q | Answer | Date | Who |
|---|---|---|---|
