# ADR-0019: Shared local-first PII sanitization via `@bugspotter/common`

- Status: Accepted
- Area: capture / privacy
- Source: `bugspotter-sdk/README.md`, `docs/SESSION_REPLAY.md`; `bugspotter-extension/CLAUDE.md`, `src/content/content-main.ts`
- Date: SDK/extension v0.1.0

## Context

Captured console/network/DOM data can contain PII and secrets (emails, phones, cards, national IDs, API keys, tokens). Regulated customers (finance, healthcare) need a compliance guarantee, and the redaction logic must not diverge between the SDK, the extension, and the backend.

## Decision

PII patterns live in a **shared `@bugspotter/common`** package and run **locally, before transmission**. Built-in patterns (email, phone, credit card, SSN/IIN, IP, API key, token, password) plus preset profiles (minimal, financial, kazakhstan, gdpr, pci) and **custom regex**; `excludeSelectors` exempt legitimate DOM. The backend sanitizes **again** as defense-in-depth.

## Consequences

### Positive

- One pattern library keeps client and server in sync; local-first redaction means PII never leaves the device unredacted.
- Defense-in-depth: a client gap is still caught server-side.

### Negative / Trade-offs

- Redacted tokens are unrecoverable by design; rare false positives (user can `exclude`).
- Capture **blocks on sanitizer init**; if init fails, capture is disabled on that page (fail-safe) and events buffered during async init are retroactively sanitized.

## Alternatives considered

- **Backend-only sanitization** — unredacted data crosses the wire. Rejected.
- **Duplicated per-client patterns** — drift risk. Rejected in favor of the shared package.
