# BugSpotter Monorepo

SaaS bug-reporting platform. pnpm + TypeScript, Docker-native dev loop.

## Shape

- `packages/` — backend (Fastify), billing, types, utils, message-broker, payment-service
- `apps/` — admin (React/Vite), demo (showcase)
- `docker-compose*.yml` — dev stack; `./dev.sh up` brings everything up including Postgres + Redis + MinIO
- **Dozzle** on `:8080` — live log viewer for running containers

## Deployment modes

The `DEPLOYMENT_MODE` env toggles major behavior:

- `saas` (prod on `*.kz.bugspotter.io`) — multi-tenancy, billing, quota enforcement, self-service signup, tenant resolution middleware.
- `selfhosted` (customer-deployable) — single tenant, no billing, no signup endpoint.

Flags that depend on mode are declared in `packages/backend/src/config.ts`.

## Common commands

```bash
./dev.sh up                                      # bring up the stack
pnpm --filter @bugspotter/backend dev            # API on :3000
pnpm --filter @bugspotter/backend typecheck      # src-only typecheck
pnpm --filter @bugspotter/backend test:unit      # no docker needed
pnpm --filter @bugspotter/backend migrate        # run DB migrations
pnpm --filter @bugspotter/admin dev              # admin UI on :5173
```

## Where things live

- **Backend** — `packages/backend/CLAUDE.md` for the auth model, migration rules, test harness.
- **Admin UI** — `apps/admin/CLAUDE.md` for routing, i18n, E2E config variants.
- **Landing signup wizard** is in a _separate_ repo: `bugspotter-landing/` (Astro).
- **Chrome extension** is in a _separate_ repo: `bugspotter-extension/`.

See also: `LOCAL_DEVELOPMENT.md`, `DOCKER.md`, `CONTRIBUTING.md`.
