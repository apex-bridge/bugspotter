# BugSpotter Onboarding

For new engineers. Tells you what the system is, what's in flight, and which existing doc to read for each task. **Not a duplicate of the other docs — a map to them.**

## What BugSpotter is

A SaaS bug-reporting platform. Customers embed an SDK in their web app; end users hit a button to file a bug; BugSpotter captures screenshot + console logs + network requests + session replay (rrweb) and routes the report through dedup/enrichment to the customer's Jira/Linear/etc. integration. Two deployment modes share one codebase:

- **`saas`** — multi-tenant on `*.kz.bugspotter.io`, billing, self-service signup, quota enforcement.
- **`selfhosted`** — single-tenant customer install, no billing, no signup.

Architecture in one sentence: Fastify API + BullMQ workers + Postgres + Redis + S3/MinIO, with a separate Python FastAPI service (`bugspotter-intelligence`) for dedup/enrichment AI.

## First 30 minutes

1. Clone the repo. Read [README.md](README.md) for the product framing.
2. Bring up the dev stack: `./dev.sh start` then `./dev.sh migrate` then `./dev.sh dev` (tmux). Full procedure in [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md).
3. Open `http://localhost:5173` (admin UI) and `http://localhost:3000` (API). Confirm both load.
4. Run `pnpm --filter @bugspotter/backend test:unit`. Should pass with no Docker needed.

If any of those steps fail, the troubleshooting section of [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) covers the common cases.

## Where to read next

| If you're going to work on...             | Start here                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| Anything backend                          | [packages/backend/CLAUDE.md](packages/backend/CLAUDE.md)                       |
| Backend system architecture               | [packages/backend/docs/architecture.md](packages/backend/docs/architecture.md) |
| Database schema, migrations, RBAC tables  | [packages/backend/docs/db-schema.md](packages/backend/docs/db-schema.md)       |
| Auth (JWT / API key / share token / RBAC) | [packages/backend/docs/auth.md](packages/backend/docs/auth.md)                 |
| Admin UI (React + Vite + i18n)            | [apps/admin/CLAUDE.md](apps/admin/CLAUDE.md)                                   |
| HTTP API surface                          | [API_DOCUMENTATION.md](API_DOCUMENTATION.md)                                   |
| Permissions / access control rules        | [ACCESS_CONTROL.md](ACCESS_CONTROL.md)                                         |
| Docker / production deploy                | [DOCKER.md](DOCKER.md)                                                         |
| Submitting a PR                           | [CONTRIBUTING.md](CONTRIBUTING.md)                                             |

The two separate repos worth knowing about:

- **`bugspotter-intelligence`** — Python FastAPI service for dedup/enrichment/mitigation. Talks to the backend over HTTP. Has its own schema (Pydantic) for `DedupRule`; the TypeScript Zod mirror in this repo at [packages/backend/src/integrations/dedup-rule.schema.ts](packages/backend/src/integrations/dedup-rule.schema.ts) must stay in lockstep.
- **`bugspotter-landing`** — Astro site, hosts the self-service signup wizard.
- **`bugspotter-extension`** — Chrome extension, separate concern from the embedded SDK.

## Repo layout

```text
packages/
  backend/          Fastify + pg + BullMQ. Most complex package.
  sdk/              The browser SDK customers embed.
  billing/          Region-specific billing plugins (KZ, …).
  types/            Shared TS types.
  utils/, message-broker/, payment-service/, backend-mock/

apps/
  admin/            React/Vite admin panel.
  demo/             Showcase site.

docker-compose*.yml + dev.sh   Local dev orchestration.
```

## What's in flight

A few active workstreams worth knowing about so you don't accidentally collide:

- **Phase 0.5 dedup-rule engine** — a tiny per-project rule engine that fires on dedup events to send acknowledgement emails, comment on canonical tickets, etc. Shipped in PRs #142 / #143 / #146 / #148 / #149 (admin CRUD currently in review). The full architecture is documented in [packages/backend/docs/architecture.md](packages/backend/docs/architecture.md) under "Dedup-rule engine."
- **Admin UI for the rule engine (PR-D2)** — frontend on top of the #149 CRUD API. Not started.
- **C2 security carry-overs** — auth-bound `reporter` recipient, per-recipient rate limit, literal-email allowlist. Block tenant-user rule authoring; rule creation is admin-only until they land.

## Common commands

```bash
# Whole-monorepo
pnpm install
pnpm build

# Backend
pnpm --filter @bugspotter/backend dev          # API on :3000
pnpm --filter @bugspotter/backend typecheck    # src-only
pnpm --filter @bugspotter/backend test:unit    # no Docker
pnpm --filter @bugspotter/backend test:integration  # needs Docker
pnpm --filter @bugspotter/backend migrate      # apply DB migrations

# Admin UI
pnpm --filter @bugspotter/admin dev            # :5173

# Optional Dozzle live log viewer (Docker compose monitoring profile)
docker compose --profile monitoring up -d dozzle  # then http://localhost:9999
```

## Conventions that aren't obvious

- **Migrations are append-only.** Never edit a merged migration; add a new one. The runner applies in lexicographic order. See [packages/backend/docs/db-schema.md](packages/backend/docs/db-schema.md) → "Migration ordering invariants" for the load-bearing ones.
- **JSONB columns are validated by Zod at the API boundary**, not by the DB. Schemas live next to the code that owns the table (`bug_reports.metadata`, `dedup_rules.rule_json`, `integration_rules.filters`, etc).
- **`request.authProject` is not a legacy field.** It's set for single-project API keys and is the gate the SDK-ingest key relies on. See [packages/backend/CLAUDE.md](packages/backend/CLAUDE.md) for the trio.
- **The notification pipeline and the dedup-rule engine are separate systems** that happen to share the `notification_throttle` table (made polymorphic in migration 023). Don't conflate them.
- **External HTTP from a plugin always routes through `security/hardened-http.ts` + `ssrf-validator.ts`.** Plugin code runs sandboxed via `security/plugin-executor.ts`.
- **The intelligence service may be off.** Treat its absence as expected: `circuit-breaker.ts` short-circuits, and the backend falls back to the no-AI code path.

## When you're stuck

- **Where does X live?** — `grep` first. The repo is 2700+ unit tests' worth of TypeScript; search beats spelunking.
- **What does this migration do?** — Read its header comment. They're written for humans.
- **What's the auth model?** — [packages/backend/docs/auth.md](packages/backend/docs/auth.md). The trio + project-access + RBAC layers are non-trivial.
- **Why does the dedup grace exist?** — See migration 021's header + [packages/backend/docs/db-schema.md](packages/backend/docs/db-schema.md) "Transactional outbox."
- **Tests pass locally but CI fails?** — The unit suite has occasional flakes in `tests/integrations/rpc-bridge-security.test.ts` (HTTP method/header timeouts). Re-run; if it persists, it's a real issue.

## Getting help

- PR review tools (CodeRabbit, Gemini, Claude) auto-review every PR. They generate a lot of signal; read their threads but use judgment — accept real findings, push back politely on noise.
- Production logs: Dozzle at `http://localhost:9999` (after enabling the `monitoring` Docker compose profile).
- Memory: there is no team chat channel pointer documented here. Ask your lead.
