# ADR-0013: Integration plugin sandbox + SSRF-hardened HTTP

- Status: Accepted
- Area: security / integration
- Source: `bugspotter-public/packages/backend/docs/architecture.md` (Integrations)
- Date: Foundational to integrations

## Context

Customer-configured integrations (Jira, Linear, generic webhooks) are effectively untrusted: a malicious or misconfigured target URL could reach internal services or exfiltrate data (SSRF).

## Decision

Route **all** plugin HTTP through `security/hardened-http.ts` + `security/ssrf-validator.ts`, which block private IPs and localhost, and run plugins inside a `security/plugin-executor.ts` sandbox. HTTP policy is enforced centrally, not per integration.

## Consequences

### Positive

- Prevents SSRF, credential leakage, and internal-service access from one choke point.
- New integrations inherit the protections automatically.

### Negative / Trade-offs

- All integration code must route through the hardened layer (slight latency).
- Legitimate internal backends need an explicit SSRF allowlist entry.

## Alternatives considered

- **Trust plugin targets** — security risk. Rejected.
- **Per-integration whitelist** — fragile and duplicated. Rejected in favor of centralized policy.
