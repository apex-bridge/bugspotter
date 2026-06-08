# ADR-0022: Client-side duplicate-report dedup

- Status: Accepted
- Area: capture / integration
- Source: `bugspotter-sdk/core/bug-reporter.ts`; `bugspotter-extension/src/background/service-worker.ts` (via `@bugspotter/common` `BugReportDeduplicator`)
- Date: SDK v0.3.0 (2025-12-20)

## Context

Users re-submit the same report in quick succession (double-click, retry confusion). Catching this only at the backend means the duplicate payload has already been uploaded and the user sees a late error.

## Decision

A shared `BugReportDeduplicator` (from `@bugspotter/common`) hashes `title + description (+ error stacks)` and blocks a re-submit within a configurable grace window, tracking both in-progress and recently-completed reports. The backend keeps a fallback check.

## Consequences

### Positive

- Stops accidental duplicates before upload; no PII in the hash; works offline.
- In-progress tracking allows immediate legitimate retry without waiting out the window.

### Negative / Trade-offs

- Dedup state is per-instance / per-service-worker (reset on eviction — acceptable, since a duplicate implies one active session).
- A slightly changed description defeats the hash (false negative); user must edit title/description to force a resubmit.

## Alternatives considered

- **Server-only dedup** — duplicate already uploaded; late error. Rejected as the sole mechanism.
- **UUID-based** — overkill. Rejected.
