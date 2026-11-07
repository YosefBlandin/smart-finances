# 0009: Sessions and sign-up

Status: accepted, 2026-10-30

## Context
Until the web UI, the user pool had self sign-up off and one owner, and the browser was to sign in with a public SRP client and keep the tokens (D-47, D-52). The web UI opens sign-up to anyone (D-61, D-67) and runs sign-up and sign-in on our own screens through the web server (D-62, D-66, ADR 0008). That needs a place for the session, a way for the server to talk to the pool, a home for consent, limits against scripted abuse that ship with sign-up, a way to delete an account, and a security baseline to check it all against. The pool stays on Cognito's free Lite plan, so its threat protection is not available.

## Decisions
- **D-72**: Sessions: an opaque id in a `__Host-` cookie keys a server-side row holding the tokens; idle 30 minutes, absolute 12 hours, new id at sign-in; sign out revokes. A reload keeps you in; the session ends with the browser, not the tab. Supersedes D-47.
- **D-73**: Sign-in from the web server with a new confidential client (secret, password flow); the server answers each challenge; the secret is read at run time by the compute role; the public client goes once this works on qa. Narrowed by D-117: no context data is sent.
- **D-87**: Consent lives in an accounts table keyed by the person: terms and privacy versions, language and time, from the pre-auth state, written at the first completed sign-in; money screens wait until it exists. Erase-all keeps it; delete account removes it. Supersedes D-78.
- **D-91**: Pre-auth state: a server-side row keyed by a separate `__Host-pre` cookie (SameSite=Strict) holds the step, the sign-in service's challenge session, the new key during setup and the accepted versions, for 15 minutes; an expired challenge returns to the password step.
- **D-92**: After a password reset, the web server signs the person out everywhere (admin global sign-out on this pool) and removes their session rows. The compute role may do that and get or delete users on this pool only.
- **D-93**: Amplify auto-build is off; after the web stack deploys, CI starts the Amplify job for the commit and waits for /api/health to report it, so the web server never runs ahead of the pool, tables and roles it needs. Also in ADR 0008.
- **D-98**: Sign-up gate: the pre-sign-up trigger accepts only the web server's client and refuses disposable domains; staging and prod keep sign-up off until the legal question Q-8 is answered. The public client is removed before any stage opens sign-up. Narrowed by D-109 (a signup-open stage parameter, false or missing means closed, read at run time) and D-118 (qa is open to anyone, with no allow-list).
- **D-104**: Delete account: first a full re-sign-in (password and code) and no running import; then mark deleting; that session alone may reach the finish route; erase, global sign-out, delete the pool user, remove rows. The hourly job finishes a stuck deletion by invoking the data service's delete function with the sub and alarms after 6 hours. Supersedes D-97.
- **D-115**: Security baseline: OWASP ASVS 5.0 level 2. The Origin must equal the stage's web address; a missing or null Origin is refused; sign-out is a post; counter keys are an HMAC of the email or address prefix. A notice goes out after a password or authenticator reset (shown at the next sign-in and logged until SES exists, D-122). Lost-authenticator recovery asks a reply from the account email plus details only the person knows, waits 72 hours, then signs out everywhere ([runbook](../runbooks/lost-authenticator.md)). Narrowed by D-153: Referrer-Policy same-origin keeps the real Origin on our own posts.
- **D-117**: No paid Cognito plan: the pool stays on Lite with no threat protection; the web server refuses breached passwords at sign-up and reset through the free Pwned Passwords range API (only the first 5 characters of the password's SHA-1 leave the server; if the API is down, the password is accepted and the miss logged). Supersedes D-94.
- **D-120**: No WAF for now, on any stage. Limits live in the web server's window counters: auth posts per IP 20 per 5 minutes, sign-in or reset failures per email and address prefix 5 per 15 minutes, code emails per email 3 an hour and 10 a day, data requests per person 120 a minute. A self-hosted proof-of-work check guards sign-up and the auth posts. Floods reach the web server's compute. Supersedes D-90 and D-105.

## Options

### Where the session lives (D-72)
- **Tokens in the browser** (D-47, D-52, superseded): no server state, but any script that runs in the page can read them.
- **Encrypted cookie holding the tokens**: no table, but tokens over 4 KB need several cookies and a session cannot be ended from the server.
- **Opaque id in a cookie, tokens in a table** (chosen): one read per request; sessions can be listed and ended, which sign-out, a reset and delete account need.

### How the server signs in (D-73, D-117)
- **The Amplify adapter with managed pages**: experimental, and its pages are not ours (ruled out by D-66).
- **SRP from the server with the public client**: no secret, and Cognito's leaked-password check does not work with SRP.
- **Password flow with a confidential client** (chosen): the server holds a secret the browser never sees. Cost: the password crosses our server and must never be logged.
- **Plus plan with threat protection** (D-94, superseded): adaptive sign-in and Cognito's breached-password check, at a monthly cost per active user; replaced by the free range check and our own counters.

### Where consent is kept (D-87)
- **In the data table through a new API route**: a contract change in another spec, and erase-all would delete it.
- **Custom pool attributes** (D-78, superseded): they cannot be removed later.
- **An accounts table the web server owns** (chosen): one more table, which also holds the account status and the per-person caps.

### Who may sign up (D-98, D-109, D-118)
- **Do nothing: sign-up stays off** (D-61 option A): only the owner can use the app.
- **Self sign-up on the pool with no gate**: anyone can call the pool directly with the public client.
- **A pre-sign-up trigger, a stage switch and the web server's client only** (chosen): sign-up goes through our limits and can be closed per stage without a deploy.

### Limits against scripted abuse (D-120)
- **WAF on the API**: not possible on an HTTP API.
- **Limits at the pool**: every call comes from the web server, so all people share its addresses.
- **WAF at the app's edge plus counters** (D-90, D-105, superseded): about 8 to 12 dollars a month per stage.
- **Window counters and a proof-of-work check in the web server** (chosen): no third party and no fixed cost. Cost: floods reach compute, and it is weaker against rotating addresses.

### Deleting an account (D-104)
- **Delete the pool user only**: the data and the consent row stay behind.
- **One step-by-step, repeatable deletion after a full re-sign-in, finished by the hourly job** (chosen): each step counts "already gone" as done, so a failure can be finished later. Cost: a deleting state the web server must honour, and one grant to invoke the data service's delete function.

## Decision
The browser holds only two opaque `__Host-` cookies: `__Host-pre` for the 15 minutes of a sign-up or sign-in in progress, and `__Host-sid` for a signed-in session. The rows they key live in a sessions table, under a SHA-256 of the cookie id. The web server runs every sign-up and sign-in step with a confidential pool client whose secret it reads at run time; consent, account status and per-person caps live in an accounts table. A pre-sign-up trigger lets only the web server's client sign up, only while the stage's signup-open parameter is "true", and never with a disposable domain. Limits are window counters keyed by an HMAC and a proof-of-work check in the web server; breached passwords are refused through the Pwned Passwords range API. Every post must carry the stage's exact Origin. OWASP ASVS 5.0 level 2 is the checklist.

## Consequences
- A session can be ended from the server: sign-out, a password reset, a lost-authenticator reset and delete account all remove the person's session rows and sign them out everywhere.
- The password and the tokens pass through the web server; the logger refuses fields named password, code, secret or token.
- Two more DynamoDB tables per stage; the accounts table is retained with point-in-time recovery and deletion protection on staging and prod.
- The compute role holds admin get, delete and global sign-out on this pool, and the housekeeping function also lists users; both are scoped to this pool only.
- Without a WAF, a flood reaches the web server's compute; the budget and error alarms are the backstop.
- Lost authenticators are reset by the owner by hand, after an identity check and a 72-hour wait; there is no self-service reset.
- Strangers' data exists on qa before the legal answer; staging and prod stay closed until Q-8 and SES.

## Revisit when
- Floods or rotating-address attacks cost more than a web firewall: add WAF at the app's edge (one stack change).
- The number of people makes the Plus plan's threat protection cheaper than its risk.
- Q-8 is answered and SES is ready: open sign-up on staging and prod and email the notices.
- Lost-authenticator requests become frequent enough to need a self-service flow.
