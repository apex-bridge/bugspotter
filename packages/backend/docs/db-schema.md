# Database Schema

Reference for the BugSpotter Postgres schema. Pairs with [architecture.md](architecture.md) for how the application uses these tables. Source of truth is the migration files in [../src/db/migrations/](../src/db/migrations/) (001 through 025); this doc is a curated overview, not an exhaustive column listing.

Two top-level schemas:

- **`application.*`** — every BugSpotter deployment. Users, projects, bug reports, integrations, notifications, the dedup-rule engine.
- **`saas.*`** — multi-tenant deployments only. Organizations, subscriptions, invitations, billing. Tables exist in selfhosted DBs but stay empty.

Schema FKs cross only one direction: `application.*` rows reference `saas.organizations` (always nullable) — never the reverse. The `application` schema is portable; `saas` is the bolt-on layer.

## Conventions

- All timestamps are `TIMESTAMPTZ`. The shared trigger function `application.update_updated_at_column()` (defined in [001_initial_schema.sql](../src/db/migrations/001_initial_schema.sql)) maintains `updated_at` on every UPDATE for any table that wires it.
- Soft-delete uses `deleted_at TIMESTAMPTZ NULL` + paired partial indexes (`WHERE deleted_at IS NULL` for hot paths, `WHERE deleted_at IS NOT NULL` for purge sweeps). Applied to `bug_reports`, `share_tokens`, `organizations`.
- JSONB columns that hold service-layer payloads are validated by Zod (or Pydantic on the intelligence side) at the trust boundary. The DB only enforces structural CHECKs (`jsonb_typeof(x) = 'object'`, non-empty arrays). Content validation is the application's job.
- Migration files are append-only. Re-running a merged migration is unsafe — add a new file (see migration ordering invariants at the bottom).

## `application.*`

### Identity + access

- **`users`** — auth principals. Either `password_hash` OR `(oauth_provider, oauth_id)`, enforced by `check_auth_method` ([001:32](../src/db/migrations/001_initial_schema.sql)). `preferences` JSONB has a GIN index. Migration [015](../src/db/migrations/015_unified_rbac.sql) added a `security` JSONB column for the unified RBAC model (today only `is_platform_admin` is documented). Migration [019](../src/db/migrations/019_email_verification.sql) added `email_verified_at` for self-service signup. The functional index `idx_users_email_lower` ([018](../src/db/migrations/018_users_email_lower_index.sql)) is non-unique by design — historical case-duplicate rows exist.

- **`email_verification_tokens`** — single-use tokens for self-service signup. Partial index on `WHERE consumed_at IS NULL` keeps the hot lookup small. Migration [019](../src/db/migrations/019_email_verification.sql).

- **`api_keys`** — hash-only storage. `permissions` is a JSONB array, `allowed_projects` a `UUID[]`. Multiple CHECKs enforce type/status/scope and non-negative rate-limit fields. A **BEFORE DELETE trigger on `projects`** (`trigger_cleanup_api_keys_on_project_delete`, [001:1273](../src/db/migrations/001_initial_schema.sql)) strips the deleted project's UUID out of every `allowed_projects` array and revokes keys whose array becomes empty. Migration [016](../src/db/migrations/016_backfill_api_key_permissions.sql) backfilled `permissions` from the legacy `permission_scope`.

- **`api_key_usage`**, **`api_key_rate_limits`**, **`api_key_audit_log`** — operational support. The rate-limit table uses composite PK `(api_key_id, window_type, window_start)` and a CHECK enumerating window types.

- **`project_roles`** + **`project_members`** — per-project RBAC. `project_roles` is seeded with `owner`/`admin`/`member`/`viewer` ([001:85](../src/db/migrations/001_initial_schema.sql)). `project_members.role` FKs `project_roles.name` (RESTRICT). Project-level access is independent of the user-level `users.role` / `users.security` columns.

- **`permissions`** (legacy) — role/resource/action tuples seeded at [001:543](../src/db/migrations/001_initial_schema.sql). Coexists with the unified-RBAC `users.security` JSONB; migration 015's comment says `users.role` is slated for deprecation but no migration has done it. Treat it as still load-bearing.

### Tenancy + projects

- **`projects`** — tenant of bug reports. `organization_id` is nullable for selfhosted (and for legacy rows). `data_residency_region` is a CHECK-enumerated string (`kz`/`rf`/`eu`/`us`/`global`) that the storage router reads.

- **`audit_logs`** — append-only audit ledger. `resource_id` is TEXT, not UUID — it can be a UUID, a file path, or an S3 key (documented in the COMMENT). `organization_id` was added and backfilled in [014](../src/db/migrations/014_audit_logs_org_scope.sql); only single-org users get attributed (multi-org users remain NULL by design).

- **`data_residency_audit`** + **`data_residency_violations`** — compliance ledger. CHECK on `violation_type`.

- **`system_config`** — global key/value JSONB store.

### Bug reports + replays

- **`bug_reports`** — the central entity. Soft-delete via `deleted_at` + `deleted_by`, plus `legal_hold` flag (partial indexes on both — [001:149-150](../src/db/migrations/001_initial_schema.sql)). Compound partial indexes `idx_bug_reports_active_project_status_created` and `idx_bug_reports_active_project_priority_created` (both `WHERE deleted_at IS NULL`) drive the dashboard. `metadata` JSONB is the SDK-supplied ingest blob, validated by Zod at the API boundary. Migration [010](../src/db/migrations/010_duplicate_detection.sql) added `duplicate_of` (self-FK) + a CHECK `chk_bug_reports_no_self_duplicate`.

- **`archived_bug_reports`** — cold storage after soft-delete. CHECK `archived_at >= deleted_at`.

- **`sessions`** — rrweb event blobs. `bug_report_id` FK cascades.

- **`share_tokens`** — public-replay grants. CHECK that the token is at least 32 chars and `expires_at > created_at`. Soft-delete via `deleted_at`. The compound index `idx_share_tokens_report_active(bug_report_id, expires_at, deleted_at)` is the access-path the share-token middleware uses.

### Integrations + tickets

- **`integrations`** — plugin catalogue. Jira is seeded in 001; Linear in [020](../src/db/migrations/020_seed_linear_integration.sql). CHECKs enumerate `plugin_source` and `trust_level`.

- **`project_integrations`** — per-project config + encrypted credentials. Circuit-breaker fields (`error_count`, `disabled_at`, `disabled_reason`) have a consistency CHECK ([001:344](../src/db/migrations/001_initial_schema.sql)) — `disabled_at` and `disabled_reason` must agree.

- **`integration_rules`** — per-integration filter/throttle/auto-create rules. `filters` and `throttle` are JSONB. A partial index targets `WHERE auto_create = true AND enabled = true`.

- **`tickets`** — external-system ticket records. UNIQUE `(platform, external_id)`. A partial index on `WHERE sync_status != 'synced'` keeps the sync-retry path fast.

- **`ticket_creation_outbox`** — the transactional-outbox table for filing tickets. UNIQUE `idempotency_key`. The status state machine is `pending → processing → completed | failed | dead_letter | skipped`, with `next_retry_at` for exponential backoff. Migration [021](../src/db/migrations/021_outbox_dedup_grace.sql) extended the enum with `skipped` and added `dedup_grace_until` + `skipped_reason` so the worker can defer filing while async intelligence populates `bug_reports.duplicate_of` (the source of the dedup-rule engine's `outbox_about_to_skip` trigger).

- **`integration_sync_log`**, **`integration_field_mappings`**, **`integration_webhooks`**, **`oauth_tokens`** — operational support. All from 001.

### Notifications

- **`notification_channels`** — channel configs. CHECK enumerates type (`email`/`slack`/`webhook`/`discord`/`teams`). `config` JSONB has a CHECK that it's an object.

- **`notification_rules`** — rule definitions. `triggers` JSONB has a CHECK enforcing non-empty array.

- **`notification_rule_channels`** — many-to-many between rules and channels (composite PK).

- **`notification_templates`** — per-channel templates. Partial UNIQUE `idx_unique_active_template(channel_type, trigger_type) WHERE is_active`. Default email + Slack templates are seeded.

- **`notification_history`** — append-only delivery log. CHECK that `status = 'sent'` implies `delivered_at IS NOT NULL`. GIN index on `recipients` (JSONB array).

- **`notification_throttle`** — rate-limit state. UNIQUE `(rule_id, group_key, window_start)`, CHECK `window_end > window_start`. The **`rule_id` column is polymorphic** since migration 023 — see "Cross-cutting patterns" below.

### Intelligence + dedup-rule engine

- **`intelligence_feedback`** ([008](../src/db/migrations/008_intelligence_feedback.sql)) — user feedback on dedup suggestions. `rating ∈ {-1, 1}`. UNIQUE per `(bug_report_id, suggestion_bug_id, user_id)`.

- **`bug_enrichments`** ([009](../src/db/migrations/009_bug_enrichments.sql)) — five confidence columns each with a `0..1` CHECK. UNIQUE on `bug_report_id` so enrichment is upsert-shaped. `enrichment_version` is the staleness column the worker checks before re-running.

- **`intelligence_deflections`** ([011](../src/db/migrations/011_deflection_tracking.sql)) — ROI counter for the dedup pipeline. UNIQUE `(project_id, matched_bug_id, description_hash)`.

- **`bug_mitigations`** ([013](../src/db/migrations/013_bug_mitigations.sql)) — manual triage actions. UNIQUE on `bug_report_id`. `organization_id` FK to `saas.organizations` with ON DELETE SET NULL.

- **`dedup_rules`** ([022](../src/db/migrations/022_dedup_rules.sql)) — the rule engine's storage. `rule_json` JSONB validated by the Zod schema at [src/integrations/dedup-rule.schema.ts](../src/integrations/dedup-rule.schema.ts) (mirrored to a Python Pydantic model in `bugspotter-intelligence`). UNIQUE `(project_id, name)`. Partial index `idx_dedup_rules_enabled_lookup(project_id) WHERE enabled = true` is the executor's hot-path access. **AFTER DELETE trigger** added in [025](../src/db/migrations/025_dedup_rules_cascade_and_seed.sql) to garbage-collect throttle rows.

## `saas.*`

Active only when `DEPLOYMENT_MODE=saas`. Selfhosted deployments still create these tables (migrations are mode-agnostic) but never write to them.

- **`organizations`** ([001:1431](../src/db/migrations/001_initial_schema.sql)) — `subdomain` UNIQUE. Migration [003](../src/db/migrations/003_organization_soft_delete.sql) added soft-delete columns and the partial index `idx_organizations_active_created … WHERE deleted_at IS NULL`. Migration [006](../src/db/migrations/006_organization_settings.sql) added `settings` JSONB with a GIN index (partial on `WHERE deleted_at IS NULL`). Known `settings` keys are documented in COMMENT only (migrations [006](../src/db/migrations/006_organization_settings.sql), [007](../src/db/migrations/007_intelligence_settings.sql)) — there's no CHECK validating shape; correctness is service-layer. Migration [012](../src/db/migrations/012_invoice_billing.sql) added a `billing_method` CHECK constraint.

- **`organization_members`** — per-org user membership. A **partial UNIQUE** `idx_org_members_one_owner_per_org(organization_id) WHERE role = 'owner'` enforces the "exactly one owner per org" invariant at the DB level.

- **`organization_invitations`** ([002](../src/db/migrations/002_organization_invitations.sql)) — pending invites. Partial UNIQUE on `(organization_id, email) WHERE status = 'pending'` blocks duplicate pending invites. Migration [004](../src/db/migrations/004_pending_owner.sql) redefined the role CHECK to include `owner` and layered a second partial UNIQUE `WHERE role = 'owner' AND status = 'pending'`. The two indexes compose: one pending invite per email + one pending owner invite per org.

- **`organization_requests`** ([005](../src/db/migrations/005_organization_requests.sql)) — public signup queue (admin-approved). Partial UNIQUE on `lower(contact_email) WHERE status IN ('pending_verification', 'verified')`. Indexes for token lookup, status/created, and IP-based rate-limit. Migration [017](../src/db/migrations/017_org_request_subdomain_index.sql) added a partial index on subdomain.

- **`subscriptions`** — 1:1 with `organizations` (UNIQUE `organization_id`). Partial UNIQUE `(payment_provider, external_subscription_id) WHERE external_subscription_id IS NOT NULL`. CHECKs enumerate plans and billing statuses. `quotas` JSONB.

- **`usage_records`** — periodic metering. UNIQUE `(organization_id, period_start, resource_type)`. CHECK enumerates resource types.

- **`legal_entities`** ([012](../src/db/migrations/012_invoice_billing.sql)) — billing identity. UNIQUE `organization_id` (1:1). `details` JSONB validated by a region-specific billing plugin; the KZ shape includes `bin` + `iik` etc. GIN index on `details->'bin'` accelerates BIN lookup.

- **`invoices`** — invoice records. UNIQUE `invoice_number` (drawn from sequence `saas.invoice_number_seq`). CHECK `amount > 0`. Status CHECK enumerates the lifecycle. Partial index `idx_invoices_due_at WHERE status IN ('sent', 'overdue')` for dunning sweeps.

- **`invoice_lines`** — line items. CASCADE on invoice delete. CHECKs on quantity/amount.

- **`acts`** — Russian/Kazakh act-of-services records. UNIQUE `act_number` (sequence `saas.act_number_seq`). Status CHECK.

## Cross-cutting patterns

### Polymorphic `notification_throttle.rule_id`

The original migration 001 declared `notification_throttle.rule_id` as an FK to `notification_rules` with `ON DELETE CASCADE`. When the dedup-rule engine landed in PR-C, it needed the same throttle infrastructure, but a single FK can only reference one parent table. The three-migration trio handled the transition:

- [023_notification_throttle_polymorphic_rule.sql](../src/db/migrations/023_notification_throttle_polymorphic_rule.sql) — dropped the FK. `rule_id` is now an opaque UUID. The unique `(rule_id, group_key, window_start)` constraint is unchanged. **This migration alone leaves cascade behavior broken** — orphan throttle rows would accumulate forever, since `cleanup_expired_throttle_windows()` is defined but not scheduled.
- [024_notification_throttle_cascade_trigger.sql](../src/db/migrations/024_notification_throttle_cascade_trigger.sql) — restored cascade for `notification_rules` via an AFTER DELETE trigger that calls `cascade_delete_notification_rule_throttle()`. Explicitly omitted the parallel trigger on `dedup_rules` because the delete path didn't exist yet.
- [025_dedup_rules_cascade_and_seed.sql](../src/db/migrations/025_dedup_rules_cascade_and_seed.sql) — added the parallel `cascade_delete_dedup_rule_throttle()` trigger on `dedup_rules`, alongside the B1/B2 seed backfill that lands with the admin delete handler in PR-D1.

The 023 → 024 → 025 sequence is the integrity unit; partial application leaves throttle garbage.

### Soft-delete

Applied to `bug_reports`, `share_tokens`, `organizations`. Pattern is `deleted_at TIMESTAMPTZ NULL` + paired partial indexes `WHERE deleted_at IS NULL` for hot paths and `WHERE deleted_at IS NOT NULL` for retention sweeps. `bug_reports` adds `legal_hold` and the cold-storage table `archived_bug_reports` to block retention.

### JSONB validated by Zod at the trust boundary

The DB enforces structural CHECKs (object, array, non-empty); content shape is validated by Zod (or Pydantic on the intelligence side) on every read and write. Examples:

- `bug_reports.metadata` — SDK-supplied; validated by the API ingest schema.
- `dedup_rules.rule_json` — validated by [src/integrations/dedup-rule.schema.ts](../src/integrations/dedup-rule.schema.ts), mirrored to Pydantic in `bugspotter-intelligence`. Drift between the two would silently break round-trip.
- `integration_rules.filters` / `throttle` / `attachment_config` — validated by the integration-rule service layer.
- `notification_rules.triggers` / `filters` / `throttle` — validated by the notification rule pipeline.
- `legal_entities.details` — validated by the per-region billing plugin.
- `organizations.settings` — known keys documented in COMMENT only ([006](../src/db/migrations/006_organization_settings.sql), [007](../src/db/migrations/007_intelligence_settings.sql)); no DDL validation. Service-layer correctness only.

### Unified RBAC (migration 015) coexists with legacy `permissions`

Migration [015](../src/db/migrations/015_unified_rbac.sql) added `users.security` JSONB next to the legacy `users.role` column. The 015 comment says `role` will be deprecated in a future migration; that migration has not been written. Today, three RBAC mechanisms coexist:

- `users.security` JSONB (platform admin flag).
- `users.role` (legacy, still load-bearing — check before assuming it's safe to ignore).
- `project_members.role` + `project_roles` (per-project, FK-validated).

The `application.permissions` table seeded in 001 holds role/resource/action tuples and is the source of truth for the system-level permission middleware. See [auth.md](auth.md) for the runtime resolution rules.

### Transactional outbox

`ticket_creation_outbox` ([001:457](../src/db/migrations/001_initial_schema.sql)) decouples bug-report creation from external ticket filing. The contract:

- API writes the outbox row in the same transaction as the `bug_reports` insert. Idempotency_key prevents duplicates on retry.
- The outbox worker polls `pending` rows, attempts plugin call, advances the state machine.
- Migration 021 added the `skipped` state and `dedup_grace_until` so a row can wait for the async intelligence dedup decision; if `duplicate_of` is set during the grace window, the row transitions to `skipped` (the dedup-rule engine's `outbox_about_to_skip` trigger fires here).

## Migration ordering invariants

A few hard requirements live in the order itself — the migrate runner applies files in lexicographic order, and some files depend on state established earlier:

- **001 must run first.** Declares both schemas, the shared `application.update_updated_at_column()` trigger function (used cross-schema), the BEFORE DELETE trigger on `projects` that cleans up `api_keys.allowed_projects`, and seeds `project_roles`. All later migrations `SET search_path` to a pre-existing schema.
- **`saas.organizations` must exist before** 003 (soft-delete cols), 006 (settings), 012 (billing_method + legal_entities), 013 (`bug_mitigations.organization_id` FK), 014 (`audit_logs.organization_id` FK), and 002 / 005 / 004 (invitation + request tables FK to it).
- **004 depends on 002.** It redefines the role CHECK constraint on `organization_invitations` and layers a second partial UNIQUE that composes with 002's index.
- **023 → 024 → 025 is the throttle-cascade integrity unit.** See the polymorphic-rule_id section.
- **025's seed depends on 022 + 001.** The seed shape must match the Zod schema at `src/integrations/dedup-rule.schema.ts` — drift here would silently store rules the executor rejects on read.
- **016 (api_keys permissions backfill) depends on 001's `api_keys`.**
- **014 backfills `audit_logs.organization_id`** from `saas.organization_members`; only single-org users get attributed, multi-org users remain NULL by design.
- **The `application` schema search_path is set per-connection** ([001:1408 comment](../src/db/migrations/001_initial_schema.sql)). Migrations that touch `saas` issue `SET search_path TO saas` and reset at the bottom.

## What this doc does not cover

- Per-column types (BIGINT vs INTEGER, VARCHAR limits) — read the migration file.
- Index storage parameters and reindex strategies — operational concerns, not in scope.
- The Python intelligence service's tables (lives in a separate repo, separate DB).
- The retention scheduler's exact sweep cadence — see [retention/](../src/retention/) in the source tree.
