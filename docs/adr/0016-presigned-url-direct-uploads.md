# ADR-0016: Presigned-URL direct-to-storage uploads

- Status: Accepted
- Area: transport
- Source: `bugspotter-sdk/README.md`, `core/file-upload-handler.ts`; `bugspotter-extension/src/background/service-worker.ts`
- Date: SDK v0.1.0 (2025-11-01)

## Context

Screenshots (~500KB) and replays (~2MB) are large. Proxying them through the API ties up the API server's bandwidth and the extension's service worker, and is slower than going straight to object storage.

## Decision

A **three-request flow**: (1) `POST /api/v1/reports` with flags → returns the bug id + **presigned PUT URLs**; (2) the client `PUT`s screenshot/replay **directly to S3** (in parallel); (3) `POST confirm-upload` per file. The report row exists after step 1, so artifact upload failures are **non-fatal** (the report still lands).

## Consequences

### Positive

- ~40% fewer requests vs the legacy 5-request flow; file bytes bypass the API server.
- Presigned URLs are time-limited and scoped to one upload; HTTPS enforced on all URLs.
- Graceful degradation: a failed replay/screenshot upload doesn't lose the report.

### Negative / Trade-offs

- Requires backend object storage and presigned-URL generation.
- The client must handle gzip content-type and parallel blob uploads.

## Alternatives considered

- **Single POST through the API** — simpler but slower and bandwidth-heavy. Rejected.
- **Multipart upload** — added complexity for these sizes. Rejected.
