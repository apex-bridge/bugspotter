# Backend Architecture

System overview for `packages/backend`. Pairs with [db-schema.md](db-schema.md) for the persistence layer and [auth.md](auth.md) for the auth model. This doc covers component boundaries, the major end-to-end flows, deployment modes, and external dependencies.

## Topology

```text
                ┌──────────────┐
                │   Admin UI   │  React/Vite, talks HTTP/JWT
                └──────┬───────┘
                       │
   SDK ── X-API-Key ──►│             ┌─────────────────────┐
                       ▼             │ Intelligence service│ FastAPI (Python)
                ┌──────────────┐ HTTP│  dedup / enrich     │ — separate repo
                │   Fastify    │◄───►│  / mitigate         │   bugspotter-intelligence
                │   API server │     └─────────────────────┘
                └──────┬───────┘
                       │
        ┌──────────────┼───────────────┬─────────────┐
        ▼              ▼               ▼             ▼
   ┌─────────┐    ┌──────────┐   ┌──────────┐  ┌──────────┐
   │Postgres │    │ Redis    │   │MinIO / S3│  │ BullMQ   │
   │ pg pool │    │ cache +  │   │ replays, │  │ workers  │
   │         │    │ BullMQ   │   │ images   │  │ (same    │
   │         │    │ backplane│   │          │  │ process  │
   │         │    │          │   │          │  │ via      │
   │         │    │          │   │          │  │ worker.ts)│
   └─────────┘    └──────────┘   └──────────┘  └──────────┘
                                      ▲              │
                                      │              ▼
                                      │       ┌──────────┐
                                      │       │  SMTP    │
                                      │       │ + Jira/  │
                                      │       │ Linear / │
                                      │       │ Slack /  │
                                      │       │ Webhook  │
                                      │       └──────────┘
                                      │
                                  data residency
                                  router selects
                                  per-org region
```

The backend runs in two processes that share the same codebase: the API server ([api/server.ts](../src/api/server.ts), bootstrapped from [index.ts](../src/index.ts)) and the worker process ([worker.ts](../src/worker.ts)). Both connect to Postgres, Redis, and S3/MinIO; the worker also opens BullMQ consumers.

## Major components

### API layer — [api/](../src/api/)

- Server bootstrap and route registration: [api/server.ts](../src/api/server.ts).
- ~40 route modules in [api/routes/](../src/api/routes/) (reports, projects, auth, signup, integrations, integration-rules, dedup-rules, intelligence-\*, notifications/, invoice-billing, share-tokens, admin-\*, deployment).
- Middleware: [api/middleware/](../src/api/middleware/) — `auth/` (JWT + API key + share token handlers), `project-access.ts`, `org-access.ts`, `audit.ts`, `metrics.ts`, `error.ts` (the centralized `AppError` handler).
- Authorization policies: [api/authorization/](../src/api/authorization/) (`guard` composer, per-resource policies). Newer routes use `guard(...)`; older ones still compose `requireAuth + requireProjectAccess + requireProjectRole(...)` in preHandler chains.

### Persistence — [db/](../src/db/)

- [client.ts](../src/db/client.ts) — single pg Pool, retry wrapper, the typed repository registry. Repositories are obtained via `db.bugReports`, `db.dedupRules`, etc.
- [transaction.ts](../src/db/transaction.ts) + `db.transaction(async tx => …)` — tx-scoped repos. `db.queryWithTransaction(async client => …)` exposes the raw `pg.PoolClient` for advisory locks.
- Raw SQL migrations live in [db/migrations/](../src/db/migrations/) — see [db-schema.md](db-schema.md) for the table map.
- Repositories under [db/repositories/](../src/db/repositories/) extend `BaseRepository<T, TInsert, TUpdate>`. A few specialized repos (outbox flows, advisory-lock paths) hand-write SQL — that's intentional.

### Queue + workers — [queue/](../src/queue/)

- [queue-manager.ts](../src/queue/queue-manager.ts) + [worker-manager.ts](../src/queue/worker-manager.ts) own the BullMQ lifecycle; [redis-connection-pool.ts](../src/queue/redis-connection-pool.ts) pools the connections.
- Job types in [queue/jobs/](../src/queue/jobs/): `integration-job.ts`, `intelligence-job.ts`, `notification-job.ts`, `replay-job.ts`, `screenshot-job.ts`.
- Workers in [queue/workers/](../src/queue/workers/): `integration-worker.ts`, `intelligence-worker.ts`, `notification-worker.ts`, `replay-worker.ts`, `screenshot-worker.ts`, `payment-event-worker.ts`, and the transactional-outbox processor at [outbox/ticket-creation-outbox.worker.ts](../src/queue/workers/outbox/ticket-creation-outbox.worker.ts).

### Integrations — [integrations/](../src/integrations/)

- Plugin core: [plugin-registry.ts](../src/integrations/plugin-registry.ts) (`PluginRegistry`), `plugin-loader.ts`, `base-integration.service.ts`, [capabilities.ts](../src/integrations/capabilities.ts) (`TicketIntegrationCapabilities`, `pluginSupports`).
- Dedup-rule schema (Zod): [dedup-rule.schema.ts](../src/integrations/dedup-rule.schema.ts). Mirrors the Python Pydantic model in `bugspotter-intelligence`; the two must stay in lockstep.
- Plugins: `jira/`, `linear/`, `generic-http/` (each with `plugin.ts`, `service.ts`, `client.ts`, `mapper.ts`, `template-renderer.ts`).
- Sandbox: [security/](../src/integrations/security/) — `plugin-executor.ts`, `code-analyzer.ts`, `hardened-http.ts`, `ssrf-validator.ts`, `rpc-bridge.ts`. Every external HTTP call from a plugin routes through `hardened-http` + `ssrf-validator`.

### Services — [services/](../src/services/)

- **Intelligence** (`intelligence/`): HTTP client for the Python service ([intelligence-client.ts](../src/services/intelligence/intelligence-client.ts)) wrapped by a circuit breaker. [dedup-service.ts](../src/services/intelligence/dedup-service.ts) (`IntelligenceDedupService.applyDedupAction`) decides whether to flag a bug as a duplicate and updates `bug_reports.duplicate_of`. Sibling services: `enrichment-service.ts`, `mitigation-service.ts`, `feedback-service.ts`.
- **Notifications** (`notifications/`): the rule-driven notification pipeline — `notification-service.ts`, channel handlers (`slack-handler.ts`, [email-handler.ts](../src/services/notifications/email-handler.ts), `discord-handler.ts`, `teams-handler.ts`, `webhook-handler.ts`), and a three-stage pipeline in `pipeline/` (rule match → throttle → deliver → history).
- **Dedup rules engine** (`rules/`): the Phase 0.5 rule engine. Detailed flow below. Files: [executor.ts](../src/services/rules/executor.ts), [dispatcher.ts](../src/services/rules/dispatcher.ts), [evaluator.ts](../src/services/rules/evaluator.ts), [context-provider.ts](../src/services/rules/context-provider.ts), [rate-limiter.ts](../src/services/rules/rate-limiter.ts), [email-sender.ts](../src/services/rules/email-sender.ts), [email-templates.ts](../src/services/rules/email-templates.ts), [seed.ts](../src/services/rules/seed.ts), [wiring.ts](../src/services/rules/wiring.ts).
- **Integrations service-layer** (`integrations/`): [auto-ticket-service.ts](../src/services/integrations/auto-ticket-service.ts) (the transactional-outbox writer), `rule-evaluator.ts`, `throttle-checker.ts`, `ticket-template-renderer.ts`.
- **Auth helpers** (`auth/`, `api-key/`): password reset, lockout, key issuance/verification, per-key rate limits.

### SaaS layer — [saas/](../src/saas/)

Only active when `DEPLOYMENT_MODE=saas`. Holds multi-tenant code that selfhosted deployments never run:

- [config.ts](../src/saas/config.ts) `getDeploymentConfig()` returns the runtime feature flags (`multiTenancy`, `billing`, `usageTracking`, `quotaEnforcement`).
- Middleware: `tenant.ts` (subdomain resolution), `tenant-match.ts`, `quota.ts`.
- Services: `signup.service.ts` (self-service onboarding atomic transaction), `organization.service.ts` (quota-checked project creation via advisory lock), `billing.service.ts`, `invitation.service.ts`, `spam-filter.service.ts`, `subdomain.service.ts`.
- Repositories: subscription, invoice, invoice-line, legal-entity, act, organization-request, usage-record.
- Scheduled jobs: `dunning.job.ts`, `invoice-scheduler.job.ts`, `trial-expiration.job.ts`, `org-request-expiration.job.ts`.

### Cross-cutting

- **DI**: [container/service-container.ts](../src/container/service-container.ts), `request-context.ts`.
- **Cache**: [cache/cache-service.ts](../src/cache/cache-service.ts) (Redis or in-memory).
- **Storage**: [storage/storage-service.ts](../src/storage/storage-service.ts) — local or S3 backend; [data-residency/regional-storage-router.ts](../src/data-residency/regional-storage-router.ts) picks per-org region.
- **Data residency**: [data-residency/](../src/data-residency/) — audit log + violation tracking + regional routing.
- **Retention**: [retention/retention-scheduler.ts](../src/retention/retention-scheduler.ts).
- **Analytics + metrics**: [analytics/](../src/analytics/), [metrics/](../src/metrics/).

## Cross-cutting flows

### 1. SDK bug submission

```text
SDK ──POST /api/v1/reports── api/routes/reports.ts
                                │
                                ├─► db.bugReports.create
                                ├─► triggerBugReportNotification    (enqueue notification-job)
                                ├─► triggerBugReportIntegrations    (enqueue integration-job + outbox row via AutoTicketService)
                                └─► triggerBugReportIntelligence    (enqueue intelligence-job)
```

The route returns 201 once the row is committed; the three trigger calls dispatch async work via BullMQ. Integration filing is mediated by the transactional outbox (`ticket_creation_outbox`) so a job retry never produces a duplicate ticket — see migration 021's "dedup grace" extension that lets the outbox worker hold off on filing until intelligence has had a chance to mark the bug as a duplicate.

### 2. Outbox worker → external ticket

```text
ticket_creation_outbox.worker.ts
   ├─► poll outbox rows in 'pending' state where next_retry_at <= now()
   ├─► resolve plugin via PluginRegistry
   ├─► plugin.service.createTicket(...)    (run inside security/plugin-executor sandbox)
   ├─► on success: write 'tickets' row + mark outbox 'completed'
   └─► on duplicate-of-set: mark outbox 'skipped' (the dedup-rule engine's
       'outbox_about_to_skip' trigger fires here)
```

### 3. Intelligence worker → dedup decision → rule engine

```text
intelligence-worker.ts
   ├─► IntelligenceClient.analyze(bugReport)         (HTTP → FastAPI)
   ├─► IntelligenceDedupService.applyDedupAction
   │     └─ on duplicate: UPDATE bug_reports SET duplicate_of, status=...
   └─► on applied: re-fetch the bug (now with duplicate_of set)
        └─► ruleExecutor.fire('duplicate_detected', updatedBug)
              (project-match guard runs first; cross-project rejection is logged)
```

### 4. Dedup-rule engine (PR-C / PR-C2 / PR-D1)

```text
Trigger source                          (outbox skip path / intelligence dedup path)
       │
       ▼
DedupRuleExecutor.fire(triggerType, bug)
   ├─► repo.findByProject(projectId, enabled=true)   (partial-indexed query)
   ├─► RuleContextProvider.build(bug)                (loads canonical, hits-in-window, etc.)
   ├─► for each rule whose 'when' matches triggerType:
   │     ├─► evaluator.matches(rule.conditions, ctx)
   │     ├─► rateLimiter.allow(rule, groupKey)        (notification_throttle row)
   │     └─► dispatcher.dispatch(ctx, action)
   │           ├─► ticket.add_comment / ticket.transition
   │           │   ├─► TicketsTableResolver — find canonical's external ticket
   │           │   └─► capability service (Jira/Linear plugin) does the call
   │           └─► notify.email
   │               ├─► resolveEmailRecipient (reporter / closer / literal)
   │               ├─► renderEmailTemplate  (subject plain, body HTML-escaped)
   │               └─► ChannelBackedEmailSender → EmailChannelHandler → SMTP
   └─► returns RuleFireResult[] for logging
```

Wiring lives in [services/rules/wiring.ts](../src/services/rules/wiring.ts) (`buildDedupRuleExecutor`). Errors inside dispatch are swallowed — the trigger hooks are wrapped in an outer try so a buggy rule never crashes a queue worker. Rules are admin-only today; tenant-user rule authoring is gated on the C2 security carry-overs (auth-bound reporter, per-recipient rate limit, literal-email allowlist).

### 5. Notification pipeline

```text
producer
   │
   ▼
NotificationService.dispatch
   ├─► pipeline/notification-rule-pipeline.ts   (match notification_rules by trigger + filters)
   ├─► pipeline/notification-delivery-service.ts (throttle via notification_throttle)
   ├─► handlers/channel-handler-registry.ts     (resolve channel type → handler)
   │     ├─► slack-handler / email-handler / webhook-handler / discord-handler / teams-handler
   │     └─► per-handler retry + circuit breaker
   └─► pipeline/notification-history-service.ts (append notification_history)
```

This pipeline predates the dedup-rule engine. The two share `notification_throttle` (made polymorphic in migration 023 — see [db-schema.md](db-schema.md)) but are otherwise independent: notifications fire off filter-matched bug events; the rule engine fires off discrete trigger types declared in `DedupRule.when`.

## Deployment modes

`DEPLOYMENT_MODE=saas | selfhosted` toggles behavior at runtime. The switch is read by [saas/config.ts](../src/saas/config.ts) `getDeploymentConfig()` and consumed in:

- `saas/middleware/tenant.ts`, `tenant-match.ts`, `quota.ts` — only run in `saas`.
- `api/server.ts` — route registration (signup route is skipped in selfhosted).
- `api/routes/auth.ts`, `api/routes/projects.ts`, `api/routes/deployment.ts` — surface conditional behavior to clients.
- `analytics/analytics-auth.ts`, `analytics/analytics-scope.ts` — org-scope vs single-tenant.
- `config/queue.config.ts` — queue partitioning per tenant.
- [config.ts](../src/config.ts) — `allowRegistration` and `selfServiceSignupEnabled` default to `true` when mode is `saas`.

The `application.*` schema is identical across modes; the `saas.*` schema is unused in selfhosted (the tables exist but stay empty). All FKs from `application.*` to `saas.organizations` are nullable so selfhosted rows can omit them.

## External boundaries

| Boundary              | Code                                                                                                                                                                  | Notes                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres              | [db/client.ts](../src/db/client.ts)                                                                                                                                   | Single pool, retry wrapper, SSL config.                                                                                                |
| Redis                 | [queue/redis-connection-pool.ts](../src/queue/redis-connection-pool.ts) + [cache/redis-cache.ts](../src/cache/redis-cache.ts)                                         | BullMQ backplane + cache.                                                                                                              |
| MinIO / S3            | [storage/](../src/storage/)                                                                                                                                           | Local or S3; region selected per-org by [data-residency/regional-storage-router.ts](../src/data-residency/regional-storage-router.ts). |
| Intelligence FastAPI  | [services/intelligence/intelligence-client.ts](../src/services/intelligence/intelligence-client.ts)                                                                   | HTTP, wrapped by [circuit-breaker.ts](../src/services/intelligence/circuit-breaker.ts). Separate repo: `bugspotter-intelligence`.      |
| SMTP                  | [services/notifications/email-handler.ts](../src/services/notifications/email-handler.ts) + various `*-email.service.ts`                                              | Nodemailer; per-channel `EmailChannelConfig` row.                                                                                      |
| Integration platforms | [integrations/jira/](../src/integrations/jira/), [integrations/linear/](../src/integrations/linear/), [integrations/generic-http/](../src/integrations/generic-http/) | All HTTP routed through `security/hardened-http.ts` + `ssrf-validator.ts`.                                                             |

## Auth surface

See [auth.md](auth.md) for the full reference — header precedence, the 3-layer authorization model, effective project role (explicit ∪ inherited), API-key bypass rules, and open policy questions.

Quick map of where things live:

- JWT + API key + share-token handlers: [api/middleware/auth/](../src/api/middleware/auth/) (`handlers.ts`, `assertions.ts`, `authorization.ts`).
- Project access enforcement: [api/middleware/project-access.ts](../src/api/middleware/project-access.ts).
- Org access enforcement: [api/middleware/org-access.ts](../src/api/middleware/org-access.ts).
- Policy composer (newer routes): [api/authorization/](../src/api/authorization/).
- API-key service: [services/api-key/](../src/services/api-key/).
- Password reset + lockout: [services/auth/](../src/services/auth/).

## What this doc does not cover

- Per-plugin integration internals (Jira ADF rendering, Linear GraphQL schemas) — see each plugin's `CLAUDE.md` if present.
- The admin UI routing and i18n — see [apps/admin/CLAUDE.md](../../../apps/admin/CLAUDE.md).
- The SDK and the landing-page signup wizard — separate repos (`bugspotter-extension`, `bugspotter-landing`).
- DB-level details — see [db-schema.md](db-schema.md).
