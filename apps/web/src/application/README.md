# application

Use cases (auth, account, data, guard, pow). They import `domain/` and `ports/` only, and get adapters through
`adapters/container.ts` from the delivery layer (D-138). The use cases arrive with PR 3 (auth) and PR 4 (screens).
