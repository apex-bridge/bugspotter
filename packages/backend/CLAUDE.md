# @bugspotter/backend

Fastify + pg + BullMQ. Most complex package in the monorepo.

## The auth trio

Every request can carry up to three auth artifacts. Get these right before writing route-level guards:

| Field                 | Set by                                                            | Meaning                                   |
| --------------------- | ----------------------------------------------------------------- | ----------------------------------------- |
| `request.authUser`    | JWT (`Authorization: Bearer <token>`)                             | Dashboard user                            |
| `request.apiKey`      | `X-API-Key: bgs_...` header                                       | SDK / machine credential                  |
| `request.authProject` | Alongside `apiKey`, **only** when `allowed_projects.length === 1` | Convenience flag for "single-project key" |

**`authProject` is NOT a legacy flag.** It's the _only_ assignment site at `src/api/middleware/auth/handlers.ts:98`, set right after `request.apiKey = apiKey` (same function). Treating it as a legacy / unrestricted bypass is a recurring misread — the self-service-signup-issued ingest-only key has `authProject` set because it's single-project, and bypassing on `authProject` would let it read reports.

## API key permission enforcement (since PR #19)

- The key's `permissions` array IS enforced on read routes. Use `requireApiKeyPermission('resource:action')` as a preHandler.
- Always delegate to the shared `checkPermission` in `src/services/api-key/key-permissions.ts` — it handles `'*'` wildcards and scope fallback for pre-backfill keys. Do not reimplement the check.
- POSTs today gate on `requireProject` + `allowed_projects` only; declared permissions are not enforced on writes yet (see the follow-up in PR #19 description).

## Schema split

- `application.*` — users, projects, bug_reports, api_keys. Everyone uses these.
- `saas.*` — organizations, subscriptions, organization_requests, invitations. SaaS-mode only.

Migrations live in `src/db/migrations/NNN_description.sql`, run via `pnpm migrate`. Never rewrite a merged migration — add a new one.

## Repository pattern

- Every repo extends `BaseRepository<T, TInsert, TUpdate>`. Use `findBy`, `findById`, `create`, `update` — don't hand-write SQL unless there's a specific reason (advisory locks, functional indexes, etc.).
- Compose filters with `createFilter()`, pagination with `createPagination()`.
- Transactions: `db.transaction(async tx => ...)` gives you the typed repo object; `db.queryWithTransaction(async client => ...)` gives you a raw `pg.PoolClient` when you need advisory locks.

## Test harness

- **Unit** (`pnpm test:unit`, no Docker) — mocks DB; `tests/setup-unit-env.ts` populates `ENCRYPTION_KEY` and `JWT_SECRET`.
- **Integration** (`pnpm test:integration`, needs Docker) — spins up a real Postgres via testcontainers in `tests/setup.ts`.

CI sets env vars via workflow; locally the setup files match that.

## Commands

```bash
pnpm dev            # tsx watch
pnpm typecheck      # src-only, fast
pnpm test:unit      # ~20s, no Docker
pnpm test:integration  # slower, needs Docker
pnpm migrate        # apply DB migrations
```
