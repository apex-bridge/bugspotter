# ADR-0004: Single codebase, runtime `DEPLOYMENT_MODE` (saas / selfhosted)

- Status: Accepted
- Area: deployment / architecture
- Source: `bugspotter-public/CLAUDE.md`, `LOCAL_DEVELOPMENT.md`, `packages/backend/src/config.ts`, `packages/backend/docs/architecture.md`
- Date: Foundational

## Context

The product ships two ways: a multi-tenant SaaS on `*.kz.bugspotter.io`, and a single-tenant self-hostable build for customers. Maintaining two forks would diverge quickly.

## Decision

One codebase gated by a runtime env var **`DEPLOYMENT_MODE`**:

- `saas` — multi-tenancy, billing, quota enforcement, self-service signup, tenant-resolution middleware.
- `selfhosted` — single tenant, no billing, no signup endpoint.

Mode-dependent flags are declared centrally in `packages/backend/src/config.ts`; SaaS-only code lives under `packages/backend/src/saas/` and never runs in self-hosted mode. The application schema is portable; the SaaS schema (organizations, billing) is a purely **additive** bolt-on layer.

## Consequences

### Positive

- One build, one test matrix; features are toggled, not forked.
- The additive SaaS schema means self-hosted installs run a strict subset.

### Negative / Trade-offs

- Config flags must stay synchronized across the codebase; a missing gate can leak SaaS behavior into self-hosted (covered by config tests).

## Alternatives considered

Not recorded in docs. A separate self-hosted fork was implicitly rejected in favor of runtime gating.
