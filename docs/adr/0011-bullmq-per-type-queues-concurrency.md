# ADR-0011: BullMQ per-type job queues with per-type concurrency

- Status: Accepted
- Area: infra
- Source: `bugspotter-public/DOCKER.md`, `packages/backend/docs/architecture.md`, `bugspotter-deploy/.env.example`
- Date: Foundational; tuning ongoing

## Context

Async work has very different cost profiles: screenshots and replays are heavy (Playwright/CPU), integrations and notifications are light I/O. A single shared queue would let a slow replay block a fast notification (head-of-line blocking).

## Decision

**BullMQ on Redis, one queue per job type**, with **per-type concurrency** tunable via env (no redeploy):
`WORKER_SCREENSHOT_CONCURRENCY=5`, `WORKER_REPLAY_CONCURRENCY=3`, `WORKER_INTEGRATION_CONCURRENCY=10`, `WORKER_NOTIFICATION_CONCURRENCY=5`, `WORKER_INTELLIGENCE_CONCURRENCY=1` (CPU-bound LLM, kept at 1 to not starve inference).

## Consequences

### Positive

- Fault isolation and fair scheduling per job type; tune to the host without code changes.
- Worker health checks simplified (no per-job-type endpoints).

### Negative / Trade-offs

- Operators must tune concurrency to their hardware; over-provisioning OOMs, under-provisioning backs up queues.
- Redis memory must account for queue backlogs; dead-letter handling is per queue.

## Alternatives considered

- **Single shared queue** — head-of-line blocking. Rejected.
- **Separate worker process per type** — deployment complexity. Rejected in favor of one worker with per-queue concurrency.
