# ADR-0018: Cross-navigation replay persistence (IndexedDB / storage.session)

- Status: Accepted
- Area: replay / storage
- Source: `bugspotter-sdk/core/storage/replay-persistence.ts`; `bugspotter-extension/src/background/replay-store.ts`, `CLAUDE.md`
- Date: SDK v0.2.0 (2025-11-21); extension cross-navigation phase

## Context

A user often reports a bug _after_ a full-page navigation or reload, but the interesting interactions happened on the previous page. In-memory replay buffers are lost across navigations. The two clients run in different environments (page context vs MV3 service worker) with different storage primitives.

## Decision

Persist the replay buffer across navigations, **opt-in**, with a per-environment mechanism:

- **SDK** (page context): a time-based circular buffer flushed to **IndexedDB** on `pagehide`/`visibilitychange`, restored on `init()`. Opt-in via a `dbName` (multi-tenant safety); atomic read+clear at restore.
- **Extension** (service worker): per-tab buffers in **`chrome.storage.session`**, keyed by `tabId`, cleared on tab close; per-tab write queue serializes appends.

Both: soft-fail if storage is unavailable; handle the restore race by queuing events emitted during restore.

## Consequences

### Positive

- Captures pre-reload activity; replays survive full-page navigations.
- IndexedDB (~100MB+) and `storage.session` (~10MB) both exceed the old localStorage 5MB limit.

### Negative / Trade-offs

- Quota handling required: on overflow, halve events while preserving the latest `FullSnapshot` anchor.
- Two implementations of the same concept (environment-dictated); kept behind the same opt-in contract.

## Alternatives considered

- **localStorage / sessionStorage** — 5MB cap, unavailable to the service worker. Rejected.
- **Server-side buffering** — privacy concern (streams pre-report data). Rejected.
