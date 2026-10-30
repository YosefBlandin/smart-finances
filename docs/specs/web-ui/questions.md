---
spec: web-ui
ticket: none
tier: L
status: executing
---
# Web UI: design system and screens: questions

<!-- Open questions only, as decision cards. A fresh context that has not read the code drafts them, so they read plainly. At most 5 per round. Every card has options with their consequences, a recommendation and a default. -->
<!-- Plain language in Context and option lines: at most 25 words per sentence, no backticks, terms from the intent.md glossary. Default NONE means a written yes is required; use it only when Blocks names a gate. -->
<!-- When a card is answered: delete it, add a row to Answered, and record the decision in decisions.md. -->

## Send list
<!-- Who gets which cards, by role. No names or emails. Sending stays manual. Example row: | product | Q-1 | | | -->
| Owner | Questions | Sent on | Channel |
|---|---|---|---|
| owner | Q-4, Q-5, Q-6, Q-7 | 2026-10-30 | this chat |
| legal | Q-8 | | |

## Open
<!-- Example card:
### Q-1 · Should page views from the mobile app be recorded?
Blocks: G-design · Default: B · Door: 2-way · Owner: product · Answer-by: 2026-10-30
Context: The web app will record each page a person opens. The mobile app is being retired.
A. Record mobile page views too: a complete history, but about one more week of work.
B. Record web page views only: ships sooner, and mobile visits leave no page-view event.  We recommend B because the mobile app is being retired.
If no answer by 2026-10-30, we build B.
-->
### Q-8 · What the law asks before we store strangers' money data
Blocks: G-promote · Default: NONE · Door: 1-way · Owner: legal · Answer-by: 2026-11-20
Context: Our research is not legal advice. Argentina asks for a registered database, informed consent, access answers within 10 days and deletion within 5 working days. It also asks for contract terms before data is stored in the United States. Erased data stays restorable in backups for 35 days. Venezuela grants a right to see and delete one's data but has no data law. The app gives no investment advice and moves no money, but no source gives safe wording for saying so. We have not researched sanctions that affect Venezuelan users.
A. A lawyer reviews the privacy notice, terms, the 35-day backup window and our wording before public sign-up opens. Sign-up opens later, and the review costs money.  We recommend A because the duties apply from the first stranger's data, and closing sign-up later still leaves their data with us.
B. Open sign-up with a privacy notice and terms we write ourselves, and get a review later: sign-up opens sooner at no legal cost. We risk breaking duties toward the first strangers, and their data stays with us even if we close sign-up.
If no answer by 2026-11-20, sign-up stays closed to the public.


## Answered
<!-- One row per answered card: question id, → the decision id, date, role. -->
| Q | Answer | Date | Who |
|---|---|---|---|
| Q-1 | → D-45 | 2026-10-30 | owner |
| Q-2 | → D-46 | 2026-10-30 | owner |
| Q-3 | → D-47 | 2026-10-30 | owner |
| Q-4 | → D-65 | 2026-10-30 | owner |
| Q-5 | → D-66 | 2026-10-30 | owner |
| Q-6 | → D-67 | 2026-10-30 | owner |
| Q-7 | → D-68 | 2026-10-30 | owner |
