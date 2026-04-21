# @bugspotter/backend

Fastify + pg + BullMQ. Most complex package in the monorepo.

## The auth trio

Every request can carry up to three auth artifacts:

| Field                 | Set by                                                  | Meaning                                 |
| --------------------- | ------------------------------------------------------- | --------------------------------------- |
| `request.authUser`    | JWT (`Authorization: Bearer <token>`)                   | Dashboard user                          |
| `request.apiKey`      | `X-API-Key: bgs_...` header                             | SDK / machine credential                |
| `request.authProject` | Alongside `apiKey` when `allowed_projects.length === 1` | Convenience flag for single-project key |

**`authProject` is NOT a legacy flag.** It's set inside `handleNewApiKeyAuth` (`src/api/middleware/auth/handlers.ts`), only after `request.apiKey` is set, and only for single-project keys — which includes the self-service-signup-issued ingest-only key. Bypassing on `authProject` would let that key read reports, so don't.

## API key permission enforcement

- Read routes enforce the key's `permissions` via `requireApiKeyPermission('resource:action')` as a preHandler.
- Delegate to the shared `checkPermission` in `src/services/api-key/key-permissions.ts` — it handles `'*'` wildcards and scope fallback for pre-backfill keys. Don't reimplement.
- Write routes (POST/PATCH/DELETE on reports) currently gate on `requireProject` + `allowed_projects` only; the permissions array is advisory on writes until the same middleware is applied there.

## Schema + migrations

- `application.*` — users, projects, bug_reports, api_keys (used in every mode).
- `saas.*` — organizations, subscriptions, organization_requests, invitations (SaaS-mode only).
- Migrations in `src/db/migrations/NNN_description.sql`, run via `pnpm migrate`. Never rewrite a merged migration — add a new one.

## Repositories + transactions

- Most CRUD-style repos extend `BaseRepository<T, TInsert, TUpdate>` — prefer `findBy` / `findById` / `create` / `update` and compose filters via `createFilter()`, pagination via `createPagination()`. A few specialized repos (outbox flows, advisory-lock paths) hand-write SQL; that's intentional.
- `db.transaction(async tx => ...)` for tx-scoped repo calls. `db.queryWithTransaction(async client => ...)` gives you a raw `pg.PoolClient` when you need advisory locks.

## Test harness

- **Unit** (`pnpm test:unit`, no Docker): mocks DB; `tests/setup-unit-env.ts` populates `ENCRYPTION_KEY` + `JWT_SECRET` so the suite runs standalone.
- **Integration** (`pnpm test:integration`, needs Docker): spins up real Postgres via testcontainers from `tests/setup.integration.ts`.
