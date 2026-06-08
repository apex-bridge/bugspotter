# ADR-0014: Per-organization data residency routing

- Status: Accepted
- Area: data / compliance
- Source: `bugspotter-public/packages/backend/docs/architecture.md`, `db-schema.md` (projects table)
- Date: Foundational to SaaS

## Context

Multi-tenant SaaS serves customers in different regulatory regions (KZ, RF, EU, US) with data-localization requirements. A single global bucket would be a compliance risk.

## Decision

A `projects.data_residency_region` enum (`kz` / `rf` / `eu` / `us` / `global`) drives a storage-backend router (`regional-storage-router.ts`) that selects the S3 bucket per region. Routing happens at the **storage layer**, transparent to application code. An audit log tracks residency violations. Settings propagate via `organization_settings` JSONB.

## Consequences

### Positive

- Compliance with regional data laws without per-feature special-casing.
- Application code is region-agnostic; routing is centralized.

### Negative / Trade-offs

- Must provision an S3 bucket per region.
- Cross-region reads are impossible **by design** (a constraint, not a bug).

## Alternatives considered

- **Single global bucket** — compliance risk. Rejected.
- **Customer-managed regions** — operational burden on customers. Rejected.
