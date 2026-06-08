# ADR-0020: Client offline queue with backoff retry

- Status: Accepted
- Area: transport / storage
- Source: `bugspotter-sdk/core/offline-queue.ts`, `core/transport.ts`; `bugspotter-extension/src/utils/offline-queue.ts`
- Date: SDK v0.1.0 / v0.3.0

## Context

Users go offline or hit transient network failures. A report should not be lost on page close, but unbounded retries waste battery/bandwidth and retrying auth/quota errors is pointless.

## Decision

Persist failed reports (network errors only) to a bounded local queue and retry with **jittered exponential backoff**:

- **SDK** — `localStorage` queue (up to 10 items), backoff 1–30s, retry on 502/503/504/429, never on auth errors.
- **Extension** — `chrome.storage.local` queue with a **7-day TTL**, retried on service-worker startup; drops items >100KB, after 5 attempts, on insecure endpoints, or on expiry; strips sensitive headers and screenshot/replay flags before queuing.

## Consequences

### Positive

- No report lost to a brief outage; backoff + jitter avoids thundering herd.
- Auth/quota errors fail fast (retrying wouldn't help).

### Negative / Trade-offs

- Queue competes for local storage quota; on overflow the oldest item is dropped.
- Queued extension reports lose screenshot/replay artifacts (still useful for repro).

## Alternatives considered

- **In-memory queue** — lost on reload. Rejected.
- **Unbounded queue / fixed backoff** — storage pressure / CPU spikes. Rejected.
