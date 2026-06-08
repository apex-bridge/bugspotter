# ADR-0024: Browser extension on MV3 stateless service worker

- Status: Accepted
- Area: extension architecture
- Source: `bugspotter-extension/CLAUDE.md`, `src/background/service-worker.ts`
- Date: Chrome MV3 migration (platform-mandated)

## Context

Chrome Manifest V3 removed persistent background pages. The service worker can be evicted after ~30s of inactivity, so any state held in module-level variables is lost across navigations and re-injections.

## Decision

Implement a **fully stateless service worker**: no module-level state; all persistent data lives in `chrome.storage` (`session` for transient per-tab buffers — see [0018](0018-cross-navigation-replay-persistence.md); `local` for the offline queue — see [0020](0020-client-offline-queue-retry.md)). Every event handler reads state from storage rather than memory.

## Consequences

### Positive

- Survives worker eviction, tab navigation, and re-injection without data loss — MV3-compliant.

### Negative / Trade-offs

- Async storage reads on every event add latency and require per-tab write-queue serialization to avoid read-modify-write races.

## Alternatives considered

- **MV2 background page** — deprecated by Chrome. Rejected (forced).
- **In-memory buffers** — unsafe under eviction. Rejected.
