# ADR-0017: Backend-controlled, cached replay quality settings

- Status: Accepted
- Area: settings / capture
- Source: `bugspotter-sdk/src/index.ts`, `docs/SESSION_REPLAY.md`; `bugspotter-public` API_DOCUMENTATION.md (`/api/v1/settings/replay`)
- Date: SDK v0.3.0 (2025-12-20)

## Context

Different deployments and pricing tiers want different replay fidelity (inline images, fonts, canvas recording). Hardcoding this in the SDK would mean a redeploy of every customer's embedded SDK to change a setting.

## Decision

On `init()`, the SDK fetches **`GET /api/v1/settings/replay`** for project-level quality settings and caches them (5-minute TTL). Explicit user config **overrides** server settings; if the endpoint is unreachable, the SDK **soft-fails to hardcoded safe defaults**. The endpoint returns `200 OK` with defaults even on DB failure, and is per-API-key rate-limited (10 req/min).

## Consequences

### Positive

- Admins tune replay quality per project with no SDK redeploy.
- Caching reduces backend load; user overrides always win.

### Negative / Trade-offs

- One extra HTTP call during `init()` (~50ms typical).
- A misconfigured backend silently yields default fidelity (acceptable, but invisible).

## Alternatives considered

- **Hardcoded SDK defaults** — inflexible. Rejected.
- **Per-request negotiation** — latency on every capture. Rejected.
