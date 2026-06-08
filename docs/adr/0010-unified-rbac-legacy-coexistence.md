# ADR-0010: Unified RBAC with legacy `permissions` coexistence

- Status: Accepted (legacy deprecation in progress)
- Area: auth
- Source: `bugspotter-public/packages/backend/docs/db-schema.md` (migration 015), `ACCESS_CONTROL.md`
- Date: Migration 015 introduced modern flags; legacy drop pending

## Context

The platform evolved from a legacy `users.role` + `permissions` table toward modern RBAC, but a big-bang schema change would be risky on a live system.

## Decision

Run **three coexisting RBAC layers**, migrating incrementally:

- **Platform** — `users.security` JSONB (e.g. `is_platform_admin`).
- **Org** — organization membership.
- **Project** — `project_members.role` + `project_roles`.

The legacy `users.role` and `permissions` table remain load-bearing; helpers like `isPlatformAdmin` have fallbacks. The migration to drop the legacy `role` column is **not yet written**.

## Consequences

### Positive

- Incremental migration with no breaking change; old and new paths coexist.

### Negative / Trade-offs

- Three RBAC mechanisms live in production simultaneously — real complexity for new engineers.
- Deprecation is unfinished; this ADR will be **superseded** by one that records dropping the legacy column.

## Alternatives considered

- **Immediate full migration** — breaking and risky. Rejected.
- **Stay on legacy** — no forward progress. Rejected.
