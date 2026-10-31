# smart-finances

A personal finance assistant: import your money data, see it in a dashboard, and ask questions answered by tools and RAG with citations. Built on serverless AWS with an evaluation suite and an AI security review.

## Layout

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js app: dashboard, chat UI and its web server ([ADR 0008](docs/adr/0008-web-framework-and-host.md)) |
| `apps/api` | Lambda handlers |
| `packages/contracts` | Shared by `apps/web` and `apps/api`: Zod schemas for the data routes, the field, kind and category lists |
| `infra` | AWS CDK stacks |
| `evals` | Golden set, harness, regression gate |
| `docs/adr` | Architecture decision records |
| `data/synthetic` | Synthetic dataset (the only data committed) |

## Branches

`main` (history of the previous Angular app until this lands) · `qa` · `staging` · `feature/*`

The Vercel project linked to this repo built the old Angular app. `vercel.json` turns off its Git deployments until `apps/web` has a real app; re-enable them then and point the project's root directory at `apps/web`.

## Status

Early scaffold. Work is tracked as Epics 0-7 in the execution plan.

The web app is hosted on Amplify Hosting ([ADR 0008](docs/adr/0008-web-framework-and-host.md)). The Vercel project stays off: `vercel.json` keeps its Git deployments disabled.
