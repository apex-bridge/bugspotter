# BugSpotter Monorepo

SaaS bug-reporting platform. pnpm + TypeScript, Docker-native dev loop.

## Shape

- `packages/` — backend (Fastify), billing, types, utils, message-broker, payment-service
- `apps/` — admin (React/Vite), demo (showcase)
- `docker-compose*.yml` — dev stack; `./dev.sh start` brings everything up including Postgres + Redis + MinIO. `./dev.sh help` lists the other subcommands. (`./dev.sh` is a bash script — on Windows run it from git-bash or WSL, not PowerShell.)
- **Dozzle** (optional live log viewer) is behind the `monitoring` profile — NOT started by `./dev.sh start`. Bring it up with `docker compose --profile monitoring up -d dozzle`; then `http://localhost:9999`.

## Deployment modes

The `DEPLOYMENT_MODE` env toggles major behavior:

- `saas` (prod on `*.kz.bugspotter.io`) — multi-tenancy, billing, quota enforcement, self-service signup, tenant resolution middleware.
- `selfhosted` (customer-deployable) — single tenant, no billing, no signup endpoint.

Flags that depend on mode are declared in `packages/backend/src/config.ts`.

## Common commands

```bash
./dev.sh start                                   # bring up the full stack
pnpm --filter @bugspotter/backend dev            # API on :3000 (single service, no full stack)
pnpm --filter @bugspotter/backend typecheck      # src-only typecheck (gates CI)
pnpm --filter @bugspotter/backend typecheck:tests # tests too; ~184 known errors, not gating
pnpm --filter @bugspotter/backend test:unit      # no docker needed
pnpm --filter @bugspotter/backend migrate        # run DB migrations
pnpm --filter @bugspotter/admin dev              # admin UI on :5173
```

## Conventions

- **Branch off `main`** for any new work or follow-up fix — squash-merged source branches still exist but are dead, don't build on them.
- **Run `test:unit` before pushing** behavior changes — a passing `typecheck`/build is not sufficient.
- **Prefer purely-additive slices**; verify deploy state before assuming. Avoid regressions over cleverness.
- **Every production write needs its own fresh, explicit approval** — deploying to the netcup host, SSHing in to change state, anything that touches what's actually running. Never generalize a prior "yes, deploy this" into a standing instruction for a later, different change, even in the same file or the same session — and this applies to subagents too: don't pre-authorize a production write in a dispatch prompt, have the subagent stop and report back instead.

## Skills

`.claude/skills/` holds repo-specific Claude Code skills (procedural runbooks loaded on demand). Currently: `bs-backup-health` (read-only prod backup freshness/DR check). Invoke via the skill name or its trigger phrases.

## Where things live

- **Backend** — `packages/backend/CLAUDE.md` for the auth model, migration rules, test harness.
- **Admin UI** — `apps/admin/CLAUDE.md` for routing, i18n, E2E config variants.
- **Landing signup wizard** is in a _separate_ repo: `bugspotter-landing/` (Astro).
- **Chrome extension** is in a _separate_ repo: `bugspotter-extension/`.

See also: `LOCAL_DEVELOPMENT.md`, `DOCKER.md`, `CONTRIBUTING.md`.
