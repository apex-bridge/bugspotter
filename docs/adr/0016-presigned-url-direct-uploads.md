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
- **The object store becomes a browser-facing dependency, so where it lives is now client-visible configuration.** Because the bytes bypass the API, the browser resolves the storage host itself, and every browser-side control over that host applies: it must be publicly resolvable; it must be HTTPS in production (`validateS3Endpoint` in `packages/backend/src/config/validators.ts`, which exempts container-internal hostnames); its CORS policy must cover both directions of traffic, which are not the same shape - the upload is a cross-origin `PUT` carrying a gzip content type, so it triggers a preflight and needs `PUT` plus that header allowed, while the replay read is a bare `fetch` GET that sends no preflight and needs only `Access-Control-Allow-Origin` on the response; and the admin's CSP must name it in both `img-src` and `connect-src`. That last one is the trap, because `S3_ENDPOINT` and the CSP's `STORAGE_DOMAIN` are separate settings describing one fact, and nothing server-side notices when they disagree: signing still succeeds, uploads still get a URL, and every health check stays green while the browser silently refuses the request. Both halves have bitten production - `S3_ENDPOINT=http://minio:9000` broke uploads (#289) and an empty `STORAGE_DOMAIN` broke replay and screenshot reads (#302). The admin entrypoint now cross-checks the two and refuses to start on a mismatch (`scripts/shared/validate-api-domain.sh`), which is a guard against this consequence, not a removal of it: any new client that reaches storage directly inherits the same requirement.

## Alternatives considered

- **Single POST through the API** — simpler but slower and bandwidth-heavy. Rejected.
- **Multipart upload** — added complexity for these sizes. Rejected.
