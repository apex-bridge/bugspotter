# ADR-0023: Framework-agnostic async singleton SDK `init()`

- Status: Accepted
- Area: build / SDK API
- Source: `bugspotter-sdk/src/index.ts`, `CHANGELOG.md` (v0.3.0)
- Date: SDK v0.3.0 (2025-12-20)

## Context

The SDK must work the same in React, Vue, Angular, Next.js, plain JS, and via CDN. Initialization is inherently async (it fetches backend replay settings — see [0017](0017-backend-controlled-replay-settings.md)), and multiple `init()` calls would duplicate observers/network interception/DOM hooks.

## Decision

A static **`async BugSpotter.init()` returning `Promise<BugSpotter>`** that enforces a **singleton**: it warns on re-init and **coalesces concurrent init calls** (first call wins). `destroy()` is required before re-initializing with new config.

## Consequences

### Positive

- One instance prevents duplicate interception; framework-agnostic (no framework adapter needed).
- Async contract lets `init()` fetch backend config cleanly.

### Negative / Trade-offs

- Callers must `await init()` and call `destroy()` to reconfigure.
- The implicit singleton adds coupling in tests.

## Alternatives considered

- **Factory per call** — duplicate interception and memory leaks. Rejected.
- **Synchronous init** — can't fetch backend config. Rejected.
