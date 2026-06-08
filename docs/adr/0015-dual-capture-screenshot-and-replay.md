# ADR-0015: Dual capture — screenshot + rrweb session replay

- Status: Accepted
- Area: capture
- Source: `bugspotter-sdk/README.md`, `CHANGELOG.md` (v0.1.0, v0.2.0); `bugspotter-extension/CLAUDE.md`
- Date: SDK v0.1.0 (2025-11-01); replay added v0.2.0 (2025-11-21)

## Context

A bug report needs both visual proof (what the screen looked like) and causal context (the sequence of interactions that led there). A screenshot alone misses the sequence; a replay alone misses point-in-time visual state.

## Decision

Capture **both**: a mandatory **screenshot** (via `html-to-image`, CSP-safe) plus an optional **rrweb session replay** (a bounded ~15–30s buffer). Both are compressed and uploaded via presigned URLs (see [0016](0016-presigned-url-direct-uploads.md)). rrweb is the industry-standard DOM-mutation recorder.

## Consequences

### Positive

- Screenshot = point-in-time proof; replay = causality. Together they make reports reproducible.

### Negative / Trade-offs

- ~500ms screenshot latency and rrweb memory overhead; two payloads to upload.
- Pulls in both `rrweb` and `html-to-image` dependencies.

## Alternatives considered

- **Screenshot only** — loses interaction context. Rejected.
- **Replay only** — loses visual state. Rejected.
- **Video capture** — bandwidth-prohibitive. Rejected.
