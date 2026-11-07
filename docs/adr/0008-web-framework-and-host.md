# 0008: Web framework and host

Status: accepted, 2026-10-30

## Context
No ADR picked the web framework or the web host. The plan's default was Next.js on Amplify Hosting, with a static export on S3 and CloudFront as the alternative, and the repo still carries a Vercel config that turns Git deployments off for the old Angular app. The first design chose a static Vite single-page app (D-49) with sign-in in the browser (D-52), built once and uploaded by CDK with no Git connection (D-50, D-51). Keeping tokens out of the browser and a strict content policy then pointed to a web server that holds the session, and the owner chose a hosted build connected to the repo over wiring the upload by hand.

## Decisions
- **D-62**: Next.js with server rendering, and the session held by the web server in cookies page scripts cannot read; the browser never holds a token. Supersedes D-49 and D-52.
- **D-65**: The web app and its web server run on Amplify Hosting connected to the GitHub repo, which builds and deploys it per branch (qa, staging, main). The owner accepted a second deploy path, a GitHub connection, run-time settings written at build time, and no streaming. Supersedes D-50 and D-51.
- **D-89**: Everything runs in us-east-1, where the stacks already are, so the web ACL lives in the web stack and no stage value is read across regions. Supersedes D-84.
- **D-93**: Amplify auto-build is off; after the web stack deploys, CI starts the Amplify job for the commit and waits for /api/health to report it. The CI role gets start and read job rights on this app only. Narrows D-65.
- **D-102**: The Amplify app was created in the console with Amplify's GitHub App (app smart-finances, branch qa, us-east-1); the web stack adopts it by the id in a stage parameter and sets its platform, roles, firewall and branch settings through custom resources. No GitHub token is stored. Narrows D-71.
- **D-138**: The web server's logic is hexagonal (domain, application use cases, ports, adapters, with in-memory adapters for tests and Storybook); Next.js app/ only delivers (pages, layouts, server actions, JSON routes) and calls use cases through one container; presentation (ui, screens, queries, i18n) follows Next.js conventions. ESLint import rules enforce the dependency direction.

## Options

### Framework (D-62)
- **Vite single-page app built to static files** (D-49, superseded): no server to run and a content policy with no inline scripts, but sign-in tokens live in the browser.
- **Next.js with server rendering and a server-held session** (chosen): the browser never holds a token and pages can be guarded on the server. Cost: a web server to run, and a per-request nonce for the content policy.

### Host (D-65, D-102)
- **Static export on S3 and CloudFront**: cheapest, but no server, so it does not fit D-62.
- **Next.js on Lambda behind CloudFront with OpenNext, deployed by CDK**: no Git connection and one deploy path, but more wiring to own.
- **Vercel**: the project already exists for the old app, but it sits outside AWS, away from the data, the pool and the account's alarms.
- **Amplify Hosting connected to the repo** (chosen): managed Next.js compute per branch. Cost: a second deploy path, a GitHub connection, settings fixed at build time and no streaming.
- **Amplify app made by CDK with a GitHub token in Secrets Manager** (D-71 as first written): a long-lived token to store and rotate. Replaced by adopting the console-made app, connected through Amplify's GitHub App (D-102).

### Builds (D-93)
- **Amplify auto-build on every push**: a deploy that can run before or without the CDK stacks it needs.
- **CI starts the Amplify job after the web stack deploys** (chosen): CI stays in charge of the order and checks /api/health for the commit. Cost: start and read job rights for the CI role on this app.

### Region (D-89)
- **Web ACL in a separate us-east-1 stack, app elsewhere** (D-84, superseded): cross-region stage values.
- **Everything in us-east-1** (chosen): the stacks already live there, so nothing is read across regions.

### Server code (D-138)
- **Logic inside Next.js routes and actions**: less code now, but tests and Storybook need the real AWS services or mocks per file.
- **Hexagonal server with one container** (chosen): use cases run against in-memory adapters in tests and Storybook, and the dependency direction is checked by ESLint.

## Decision
apps/web is a Next.js 15 App Router app with server rendering. It runs on Amplify Hosting in us-east-1, one branch per stage (qa, staging, main), on the app created in the console with Amplify's GitHub App and adopted by the web stack by id. Auto-build is off: CI deploys the stacks, then starts the Amplify job for the commit and waits for /api/health to report it. The server code follows domain, application, ports and adapters, wired in one container; the data route schemas and the field, kind and category lists shared with apps/api live in packages/contracts. The Vercel project stays off.

## Consequences
- The session lives on the server in an http-only cookie; no token reaches page scripts.
- Settings the server needs at run time are written at build time, so changing one means a new Amplify build.
- No streamed responses: pages render whole, with skeletons for content that loads on the client.
- One GitHub connection exists through Amplify's GitHub App; no GitHub token is stored in the account.
- CI holds start and read job rights on this one Amplify app.

## Revisit when
- Streaming or a run-time setting change without a build is needed.
- Amplify's Next.js support falls behind the Next.js version in use: OpenNext on Lambda with CDK is the fallback.
- The web app moves to another region or account (see ADR 0007).
