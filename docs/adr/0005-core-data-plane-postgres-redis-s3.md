# ADR-0005: Core data plane — Postgres 16 + Redis 7 + S3/MinIO

- Status: Accepted
- Area: data / infra
- Source: `bugspotter-deploy/docker-compose.yml`, `bugspotter-deploy/README.md`, `bugspotter-public/DOCKER.md`
- Date: Foundational

## Context

The platform needs durable relational state (bugs, orgs, rules), a job queue + cache, file storage for screenshots and replays, and — for the AI tier — vector similarity. It must run on customer infrastructure with no cloud-vendor lock-in.

## Decision

Three infrastructure services:

- **PostgreSQL 16** — primary relational store, with the **pgvector** extension for embeddings (see [0027](0027-pgvector-ivfflat-similarity.md)).
- **Redis 7** — BullMQ job queue (see [0011](0011-bullmq-per-type-queues-concurrency.md)) and cache.
- **MinIO** — S3-compatible object storage for screenshots/replays; backable by local disk or any external S3.

## Consequences

### Positive

- pgvector keeps vectors in the same ACID store — no separate vector DB to operate.
- S3-compatibility means no vendor lock-in; the same code targets MinIO on-prem or a cloud S3.
- Standard, battle-tested components available everywhere.

### Negative / Trade-offs

- Three persistent volumes to back up, each with its own strategy (`pg_dump`, MinIO sync, Redis AOF).
- Postgres needs tuning (`shm_size` set explicitly) to avoid OOM under load.

## Alternatives considered

- **MongoDB** — loses transactional guarantees. Rejected.
- **A dedicated vector database** — extra operational surface; pgvector was sufficient. Rejected.
- **RabbitMQ** instead of Redis — more complex than the queue needs. Rejected.
