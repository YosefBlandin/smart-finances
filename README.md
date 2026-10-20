# smart-finances

A personal finance assistant: import your money data, see it in a dashboard, and ask questions answered by tools and RAG with citations. Built on serverless AWS with an evaluation suite and an AI security review.

## Layout

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js dashboard and chat UI |
| `apps/api` | Lambda handlers |
| `infra` | AWS CDK stacks |
| `evals` | Golden set, harness, regression gate |
| `docs/adr` | Architecture decision records |
| `data/synthetic` | Synthetic dataset (the only data committed) |

## Branches

`main` (history of the previous Angular app until this lands) · `qa` · `staging` · `feature/*`

The Vercel project linked to this repo built the old Angular app. `vercel.json` turns off its Git deployments until `apps/web` has a real app; re-enable them then and point the project's root directory at `apps/web`.

## Status

Early scaffold. Work is tracked as Epics 0-7 in the execution plan.
