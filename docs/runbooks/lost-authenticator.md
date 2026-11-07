# Runbook: lost authenticator

Who runs it: the owner, by hand. When: someone writes to the stage's support address saying they lost their authenticator. Decisions: D-115 (identity proof, 72-hour wait, sign out everywhere), D-103 and D-148 (the lost-authenticator page), D-122 (the notice until SES exists), D-92 (sign out everywhere and remove the session rows). See [ADR 0009](../adr/0009-sessions-and-sign-up.md).

There is no self-service reset: the sign-in service has no such step, and a reset by email alone would let anyone who controls the inbox, or who guessed the password, take the account. This runbook is the only way back in.

All examples use placeholders. Never paste a real email, sub, pool id or account id into a ticket, commit or chat log.

## What you need
- The stage (`qa`, `staging` or `prod`) and its user pool id, from the stage's data stack outputs.
- The stage's sessions table name, from the stage's web stack (resource `Sessions`).
- AWS credentials allowed to call `cognito-idp` admin actions on that pool and to delete items from that table. The agent never runs these steps (D-5); the owner does.

## 1. Check the request came from the account email
1. The request must come from the email address the account signed up with. Look it up without changing anything:
   ```sh
   aws cognito-idp list-users --user-pool-id <pool id> --filter 'email = "person@example.test"'
   ```
   No match, or more than one: reply with the same neutral text as any other request ("We received your message and will check it") and stop. Do not say whether an account exists.
2. Check the message headers: the sender domain passes SPF and DKIM (look for `dkim=pass` and `spf=pass` in Authentication-Results). A forwarded message or a reply-to that differs from the sender does not count.
3. Note the user's `Username` (the sub) and the time the request arrived. Keep both in the owner's private notes, not in the repo.

## 2. Ask for details only the person knows
Reply to the account email, and only to it, asking for two or three of these:
- roughly when they signed up (month and year);
- which sources they imported (for example the card statement, the notes log or the workbook) and roughly how many imports;
- the language they use the app in;
- the month of their most recent import.

Never ask for the password, an authenticator code, a full card or account number, or an amount. If the answer contains any of those, do not use it, and tell the person never to send it.

Check the answers against the account with read-only calls (the accounts row for the language and consent time, the imports for sources and months). Two wrong answers, or a reply from any other address: refuse with the neutral text and stop. Log the refusal in the private notes.

## 3. Wait 72 hours
1. Write to the account email that a reset was asked for and will happen no earlier than 72 hours from now, unless they reply that they did not ask for it. Use the wording of the lost-authenticator page: once we confirm it is them, we wait 72 hours before the reset, so nobody else can do it quickly. Promise no reply time (D-148).
2. Note the time the wait started. Do nothing until 72 full hours have passed.
3. Any reply in that window saying they did not ask for it, or any sign the email account itself was taken over: cancel, tell the account email, and stop. Consider a password reset for the person through the normal reset screen.

## 4. Reset the authenticator
After the 72 hours:
1. Remove the authenticator so the next sign-in asks for a new one (the pool requires TOTP, so a person with none is sent to the setup step):
   ```sh
   aws cognito-idp admin-set-user-mfa-preference --user-pool-id <pool id> --username <sub> \
     --software-token-mfa-settings Enabled=false,PreferredMfa=false
   ```
   Before the first real use on any stage, try this once on qa with a synthetic test account (an `example.test` address) and confirm that the next sign-in shows the setup step and not the old code. If it still asks for the old code, stop and raise it as a new decision; do not improvise another way.
2. Sign the person out everywhere, so any session or refresh token someone else holds stops working:
   ```sh
   aws cognito-idp admin-user-global-sign-out --user-pool-id <pool id> --username <sub>
   ```
3. Remove the person's session rows from the sessions table. Find them through the `bySub` index (it holds keys only), then delete each one:
   ```sh
   aws dynamodb query --table-name <sessions table> --index-name bySub \
     --key-condition-expression 'sub = :s' --expression-attribute-values '{":s":{"S":"<sub>"}}' \
     --projection-expression pk
   aws dynamodb delete-item --table-name <sessions table> --key '{"pk":{"S":"<pk from the query>"}}'
   ```
   Run the query again: it must return no items.

## 5. Tell the person
- Until SES is set up (D-77), the notice is shown on the next sign-in screen and logged as a security event, not emailed (D-122). Reply to the account email yourself with one plain line: the authenticator was reset, they set up a new one the next time they sign in, and if they did not ask for this they should reply at once.
- Once SES sends the stage's email, the notice email after an authenticator reset replaces that manual line (D-115).

## 6. Close
- Record in the private notes: request time, the identity check result, the wait start and end, the time of each step in 4, and who ran them. No email, sub or answer goes into the repo.

## If something goes wrong
- A step in 4 fails: repeat it; each one is safe to repeat. Do not tell the person it is done until all three succeeded.
- The person cannot reach the account email any more: this runbook cannot help. Recovery needs a new decision; do not change the account's email by hand.
