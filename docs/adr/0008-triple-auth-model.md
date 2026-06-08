# ADR-0008: Triple auth — JWT user / API key ingest / share-token

- Status: Accepted
- Area: auth
- Source: `bugspotter-public/packages/backend/docs/auth.md`, `ACCESS_CONTROL.md`
- Date: Foundational; dual-header audit fix in PR-105/107

## Context

Three callers authenticate differently: dashboard users (interactive), the SDK/extension ingesting reports (machine), and public replay sharing (anonymous, scoped). One auth artifact cannot serve all three.

## Decision

Three orthogonal auth artifacts, applied by middleware in precedence order **share-token → API key → JWT**:

- `request.authUser` — JWT (dashboard users).
- `request.apiKey` — `X-API-Key` header (SDK ingest; can be single-project or full-scope).
- `request.authShareToken` — query param (public replay shares).

Authentication is separated from authorization; API keys have bypass rules for platform permissions (a machine has no "role"). Lock-in tests document the bypass behavior to catch silent regressions.

## Consequences

### Positive

- Fine-grained scoping (single-project keys); anonymous sharing without exposing user identity.
- Precedence rules are explicit and tested.

### Negative / Trade-offs

- All three fields can coexist on one request; when JWT + API key are both present, a **single-project key constraint** is needed for safe audit attribution (the PR-105/107 fix).
- Middleware state is non-trivial; bypass rules must be kept honest by the lock-in tests.

## Alternatives considered

Not recorded in docs.
