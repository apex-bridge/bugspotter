# ADR-0009: Multi-tenancy via API-key → tenant_id isolation

- Status: Accepted
- Area: auth / data
- Source: `bugspotter-intelligence/src/.../auth/service.py`, `db/migrations.py`; `bugspotter-public` SaaS schema
- Date: Intelligence Phase 2 (v0.2.0); backend SaaS foundational

## Context

In SaaS mode, every customer's data must be strictly isolated, but the system already authenticates machine callers by API key. A heavyweight tenant model would duplicate that.

## Decision

Resolve **API key → `tenant_id`** and filter **every** query by `tenant_id`. Tenant context is injected via dependency injection (FastAPI) / middleware (backend) for testability. `tenant_id` is **nullable** for backwards compatibility with pre-multi-tenant rows. There is **no global super-admin scope** — admin is per-tenant — to prevent BOLA (broken object-level authorization).

## Consequences

### Positive

- Reuses existing API-key auth; no separate tenant login.
- New tables get `tenant_id` by convention; isolation is uniform.

### Negative / Trade-offs

- Every new query must remember to filter by `tenant_id`; a missed filter is a cross-tenant leak.
- Nullable `tenant_id` means legacy rows need careful handling during reads.

## Alternatives considered

Not recorded in docs. Schema-per-tenant and database-per-tenant were not adopted (operational cost for many small tenants).
