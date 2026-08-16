# Architecture Decision Records

This directory is the **cross-repo** ADR catalog for the BugSpotter platform. It captures the major architectural and technical decisions that shape the product across all code repositories:

`bugspotter-public` (backend + admin) · `bugspotter-sdk` · `bugspotter-extension` · `bugspotter-intelligence` · `bugspotter-landing` · `bugspotter-mcp` · `bugspotter-deploy`

## Format

Each record follows a light [MADR](https://adr.github.io/madr/) shape: **Context → Decision → Consequences → Alternatives**. One decision per file, numbered. Records are immutable once `Accepted`; a reversal is a _new_ ADR that marks the old one `Superseded`.

Where the source docs do not record a rationale or the alternatives that were weighed, the ADR says so ("Not recorded in docs") rather than inventing one.

> **Interactive view:** open [`index.html`](index.html) in a browser for a searchable, filterable version of this catalog (live search, filter by status/repo/area, era navigation, `j`/`k` keyboard nav). It is self-contained — no build step or server needed.

## How the sequence is ordered

ADRs are numbered in **logical build order** — foundations first, then the backend platform, then the capture clients, then the AI tier, then signup, then the agent (MCP) surface. This is roughly the order the platform was actually built, but the number is an identifier, not a strict timestamp. Precise dates exist only where a repo records them (mostly the SDK CHANGELOG); those are noted per-ADR.

## Index

### Era 1 — Foundations

| #                                                 | Decision                                                       | Source repo(s) |
| ------------------------------------------------- | -------------------------------------------------------------- | -------------- |
| [0001](0001-pnpm-typescript-monorepo.md)          | pnpm + TypeScript workspace monorepo                           | public         |
| [0002](0002-fastify-typescript-backend.md)        | Fastify/TypeScript backend as the API core                     | public         |
| [0003](0003-dual-licensing-fsl-and-mit.md)        | Dual licensing: FSL-1.1-Apache-2.0 platform, MIT SDK           | all            |
| [0004](0004-runtime-deployment-mode.md)           | Single codebase, runtime `DEPLOYMENT_MODE` (saas / selfhosted) | public         |
| [0005](0005-core-data-plane-postgres-redis-s3.md) | Core data plane: Postgres 16 + Redis 7 + S3/MinIO              | public, deploy |
| [0006](0006-docker-compose-not-kubernetes.md)     | Docker Compose single-host orchestration (not Kubernetes)      | deploy, public |

### Era 2 — Backend platform

| #                                                      | Decision                                                                   | Source repo(s)       |
| ------------------------------------------------------ | -------------------------------------------------------------------------- | -------------------- |
| [0007](0007-polyglot-python-intelligence-service.md)   | Polyglot: separate Python intelligence service over HTTP + circuit breaker | public, intelligence |
| [0008](0008-triple-auth-model.md)                      | Triple auth: JWT user / API key ingest / share-token                       | public               |
| [0009](0009-multi-tenancy-api-key-tenant-isolation.md) | Multi-tenancy via API-key → tenant_id isolation                            | public, intelligence |
| [0010](0010-unified-rbac-legacy-coexistence.md)        | Unified RBAC with legacy `permissions` coexistence                         | public               |
| [0011](0011-bullmq-per-type-queues-concurrency.md)     | BullMQ per-type job queues with per-type concurrency                       | public, deploy       |
| [0012](0012-transactional-outbox-ticket-filing.md)     | Transactional outbox for external ticket filing                            | public               |
| [0013](0013-integration-plugin-sandbox-ssrf.md)        | Integration plugin sandbox + SSRF-hardened HTTP                            | public               |
| [0014](0014-per-org-data-residency-routing.md)         | Per-organization data residency routing                                    | public               |

### Era 3 — Capture clients (SDK + browser extension)

| #                                                       | Decision                                                          | Source repo(s)         |
| ------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------- |
| [0015](0015-dual-capture-screenshot-and-replay.md)      | Dual capture: screenshot + rrweb session replay                   | sdk, extension         |
| [0016](0016-presigned-url-direct-uploads.md)            | Presigned-URL direct-to-storage uploads                           | sdk, extension, public |
| [0017](0017-backend-controlled-replay-settings.md)      | Backend-controlled, cached replay quality settings                | sdk, public            |
| [0018](0018-cross-navigation-replay-persistence.md)     | Cross-navigation replay persistence (IndexedDB / storage.session) | sdk, extension         |
| [0019](0019-shared-pii-sanitization.md)                 | Shared local-first PII sanitization via `@bugspotter/common`      | sdk, extension         |
| [0020](0020-client-offline-queue-retry.md)              | Client offline queue with backoff retry                           | sdk, extension         |
| [0021](0021-shadow-dom-widget-isolation.md)             | Shadow DOM widget isolation                                       | sdk, extension         |
| [0022](0022-client-side-duplicate-dedup.md)             | Client-side duplicate-report dedup                                | sdk, extension         |
| [0023](0023-framework-agnostic-async-singleton-init.md) | Framework-agnostic async singleton SDK `init()`                   | sdk                    |
| [0024](0024-extension-mv3-stateless-service-worker.md)  | Browser extension on MV3 stateless service worker                 | extension              |
| [0025](0025-main-world-injection-capture.md)            | Main-world injection for CSP-proof console/network capture        | extension              |

### Era 4 — Intelligence / AI tier

| #                                                       | Decision                                                         | Source repo(s) |
| ------------------------------------------------------- | ---------------------------------------------------------------- | -------------- |
| [0026](0026-local-bge-m3-embeddings.md)                 | Local BAAI/bge-m3 embeddings (self-hosted, multilingual)         | intelligence   |
| [0027](0027-pgvector-ivfflat-similarity.md)             | pgvector + IVFFlat for similarity search (no separate vector DB) | intelligence   |
| [0028](0028-tunable-similarity-thresholds.md)           | Tunable similarity thresholds (0.68 / 0.85), per-tenant          | intelligence   |
| [0029](0029-llm-provider-abstraction-ollama-default.md) | LLM provider abstraction; Ollama `llama3.2:3b` default           | intelligence   |
| [0030](0030-smart-search-llm-rerank-fallback.md)        | Smart search LLM rerank with timeout fallback                    | intelligence   |
| [0031](0031-nl-dedup-rule-parsing.md)                   | Natural-language dedup-rule parsing via few-shot JSON            | intelligence   |
| [0032](0032-ai-observability-event-feedback-tables.md)  | AI observability: `intelligence_event` + `intelligence_feedback` | intelligence   |
| [0033](0033-offline-model-caching-docker.md)            | Offline embedding-model caching in multi-stage Docker image      | intelligence   |

### Era 5 — Signup / landing

| #                                                    | Decision                                            | Source repo(s)  |
| ---------------------------------------------------- | --------------------------------------------------- | --------------- |
| [0034](0034-astro-static-islands-landing.md)         | Astro static + islands for the landing site         | landing         |
| [0035](0035-type-safe-file-based-i18n.md)            | Type-safe file-based i18n (props-only to React)     | landing         |
| [0036](0036-self-service-signup-fragment-handoff.md) | Self-service signup with URL-fragment token handoff | landing, public |

### Era 6 — MCP (AI agent) surface

| #                                               | Decision                                              | Source repo(s) |
| ----------------------------------------------- | ----------------------------------------------------- | -------------- |
| [0037](0037-mcp-dual-mode-transport.md)         | Dual-mode MCP transport (stdio + HTTP)                | mcp            |
| [0038](0038-mcp-deliberate-six-tool-surface.md) | Deliberate six-tool MCP surface                       | mcp            |
| [0039](0039-mcp-ajv-json-schema-validation.md)  | Ajv + JSON Schema validation (single source of truth) | mcp            |
| [0040](0040-mcp-behavioral-jsonl-logging.md)    | Behavioral JSONL logging with scoped PII redaction    | mcp            |

### Era 7 — AI-SDLC / product surfaces

| #                                                            | Decision                                                                             | Source repo(s) |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ | -------------- |
| [0041](0041-ai-factory-adaptation.md)                        | AI Factory framework adaptation (mapping, not implementation)                        | public         |
| [0042](0042-agent-identity-scoped-app.md)                    | Agent identity - scoped GitHub App, not a user account                               | public         |
| [0043](0043-intelligence-show-match-score-threshold-.md)     | Intelligence: surface current match score and threshold in duplicate bug detail view | public         |
| [0044](0044-sso-oidc-account-linking-and-tenant-boundary.md) | SSO/OIDC auth extension - provider model, tenant-scoped account-linking              | public         |

## Consciously not promoted to ADRs

The following surfaced during the doc sweep but were judged implementation detail or a consequence of an ADR above, not standalone architectural decisions. Listed here so the record is honest about scope: gzip replay compression (native `CompressionStream` / `pako`); multi-format SDK build (CJS/ESM/UMD); Vite + `@crxjs` extension build; canvas/Shadow-DOM screenshot annotation overlay; domain allowlist for capture; honeypot + rate-limit spam defense on signup; Vercel static deploy + under-construction toggle; SEO/canonical metadata; Playwright serial-mode E2E; non-root Docker user; idempotent `IF NOT EXISTS` migrations (no Alembic) in the intelligence service; Prometheus metrics cardinality protection; Redis sliding-window rate limiting (Lua) and tenant-versioned cache invalidation in the intelligence service; MCP HTTP retry policy (5xx-yes/4xx-no), per-request timeouts, and 30-minute session TTL with sticky routing.

Several of these are captured as _Consequences_ inside the relevant ADR.
