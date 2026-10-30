---
spec: web-ui
ticket: none
tier: L
status: draft
---
# Web UI: design system and screens: questions

<!-- Open questions only, as decision cards. A fresh context that has not read the code drafts them, so they read plainly. At most 5 per round. Every card has options with their consequences, a recommendation and a default. -->
<!-- Plain language in Context and option lines: at most 25 words per sentence, no backticks, terms from the intent.md glossary. Default NONE means a written yes is required; use it only when Blocks names a gate. -->
<!-- When a card is answered: delete it, add a row to Answered, and record the decision in decisions.md. -->

## Send list
<!-- Who gets which cards, by role. No names or emails. Sending stays manual. Example row: | product | Q-1 | | | -->
| Owner | Questions | Sent on | Channel |
|---|---|---|---|
| owner | Q-4, Q-5, Q-6, Q-7 | | |
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
### Q-4 · Where the web server runs
Blocks: G-design · Default: B · Door: 2-way · Owner: owner · Answer-by: 2026-11-06
Context: The web app needs a web server, and AWS offers two ways to run it. Either can change later.
A. Amplify, linked to where our code is stored: Amplify fetches and builds the web app itself. It costs a second deploy path, a new link to our code and awkward server settings.
B. AWS server functions behind a fast delivery network, deployed by our current pipeline: one deploy path and no new access to our code. It costs more setup code that we own, and fewer people share this setup for help.  We recommend B because there is one deploy path and no new access to the code.
If no answer by 2026-11-06, we build B.

### Q-5 · Who draws the sign-up and sign-in screens
Blocks: G-design · Default: A · Door: 2-way · Owner: owner · Answer-by: 2026-11-06
Context: People need screens to sign up, check their email, set up an authenticator and sign in. We can use ready-made screens or draw our own.
A. Cognito's ready-made pages with our logo, colours and Spanish: least code and least security risk. They cannot match the prototype's layout, voice or wording, and people briefly visit a Cognito web address.  We recommend A because sign-in mistakes are costly and the money screens are where the voice matters most.
B. Our own screens from the prototype: they match the design system and voice exactly. The web server must run every sign-in step itself, which is more code to build and keep safe.
If no answer by 2026-11-06, we build A.

### Q-6 · Who may sign up at first
Blocks: G-design · Default: B · Door: 2-way · Owner: owner · Answer-by: 2026-11-06
Context: We need to choose who can create an account when sign-up first opens. Any choice can change later.
A. Open to anyone from the start: fastest growth. It invites fake accounts that add cost and load, and we hold real people's financial data from day one.
B. Invitation codes first, open later with one setting: sign-up needs a code the owner hands out. Growth is slower, but a few real people test the limits and costs while we watch.  We recommend B because limits and costs get tested with a few real people first.
C. A waiting list: people leave their email, and the owner lets them in one by one. It shows demand, but the owner must keep up with the list.
If no answer by 2026-11-06, we build B.

### Q-7 · How much time this work gets
Blocks: G-design · Default: B · Door: 2-way · Owner: owner · Answer-by: 2026-11-06
Context: The plan allowed two weeks for a web app only the owner uses. Adding sign-up, a web server, privacy pages, per-person limits and abuse controls roughly doubles the work.
A. One release in about five weeks: everything arrives together. The owner waits the full five weeks for anything usable.
B. Two releases: first, about three weeks for the owner's web app with the session cookie held on the web server. Then about two to three weeks for sign-up, privacy pages and limits.  We recommend B because the owner gets a working app sooner and sign-up opens only once its safeguards exist.
C. Keep two weeks and drop sign-up from this work: the owner's web app ships on time. Strangers cannot use it until a later project adds sign-up.
If no answer by 2026-11-06, we build B.

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
