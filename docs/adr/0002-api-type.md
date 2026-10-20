# 0002: API Gateway type

Status: accepted, 2026-10-20

## Context
A small JSON API for upload, dashboard data and the assistant. Needs JWT auth, throttling and low cost. Streaming assistant answers may need a different path later.

## Options
- **HTTP API**: cheaper, simpler, built-in JWT authorizer.
- **REST API**: more features (usage plans, request validation, direct WAF association).

## Decision
HTTP API with a Cognito JWT authorizer (from Epic 2).

## Consequences
- Throttling is set on the default stage (10 requests per second, burst 20) and is the main cost brake.
- Reserved Lambda concurrency is not available yet: a new account's concurrency quota is 10 and AWS requires 10 to stay unreserved, so the first deploy failed with a reservation of 5. It is now optional (`-c reservedConcurrency=N`) and needs a quota increase first.
- WAF cannot be attached to an HTTP API directly as far as I know; verify against current docs. The plan is CloudFront with WAF in front (Epic 6).
- Input validation lives in the Lambda code, not the gateway.

## Revisit when
WAF or usage plans are needed directly on the API, or response streaming forces a different integration.
