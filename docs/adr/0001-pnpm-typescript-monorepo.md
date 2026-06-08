# ADR-0001: pnpm + TypeScript workspace monorepo

- Status: Accepted
- Area: build / repo structure
- Source: `bugspotter-public/CLAUDE.md`, `CONTRIBUTING.md`, `pnpm-workspace.yaml`
- Date: Foundational (not precisely dated)

## Context

The backend, billing, message broker, payment service, shared types, shared utils, and the admin UI evolve together and share TypeScript types. They need atomic cross-package changes, a single dependency graph, and one CI pipeline.

## Decision

Use a **pnpm workspace monorepo** (`pnpm@9.14.4`, Node 22) with `packages/*` (backend, backend-mock, billing, message-broker, payment-service, types, utils) and `apps/*` (admin, demo). Cross-package work is filtered via `pnpm --filter`.

## Consequences

### Positive

- Shared `@bugspotter/types`, `@bugspotter/utils`, and `@bugspotter/common` keep contracts in one place.
- One install, one lockfile, one CI workflow (`.github/workflows/ci.yml`).
- Atomic refactors across packages in a single commit/PR.

### Negative / Trade-offs

- The SDK and the browser extension are deliberately **separate** repos (different release cadence, different licenses — see [0003](0003-dual-licensing-fsl-and-mit.md)), so some shared logic (`@bugspotter/common`) must be duplicated/published rather than imported across the workspace boundary.
- CI must understand the workspace layout; structural changes require editing `ci.yml`.

## Alternatives considered

Not recorded in docs. Polyrepo for every package would have lost atomic cross-package changes; the team kept a monorepo for the server-side platform and split only the independently-shipped clients out.
