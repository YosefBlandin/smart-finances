# 0001: Infrastructure as code tool

Status: accepted, 2026-10-20

## Context
The whole stack (API, Lambdas, data stores, auth, Bedrock, CI role) should be reproducible and reviewable in git. The author writes TypeScript daily and this project doubles as AWS learning.

## Options
- **AWS CDK (TypeScript)**: real language, typed constructs, good defaults, synthesizes to CloudFormation.
- **Terraform**: provider-agnostic, large ecosystem, HCL; separate state to manage.
- **AWS SAM**: concise for Lambda and API Gateway, less suited to everything else in the stack.

## Decision
AWS CDK in TypeScript, one app in `infra/`.

## Consequences
- Same language as the web app; infra code can share types and be unit tested.
- Deployments go through CloudFormation, so failed creates roll back and sometimes need a stack delete before retrying (seen on the first deploy).
- Default bootstrap grants CloudFormation `AdministratorAccess`. Accepted for the learning phase; tighten the execution policy in Epic 6.
- Lock-in to AWS. Acceptable: the goal is AWS depth.

## Revisit when
The project needs a non-AWS resource that CDK handles poorly, or a team joins that standardizes on Terraform.
