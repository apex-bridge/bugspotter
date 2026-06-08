# ADR-0027: pgvector + IVFFlat for similarity search (no separate vector DB)

- Status: Accepted
- Area: embeddings / data
- Source: `bugspotter-intelligence/docker-compose.yml`, `ROADMAP.md` (Phase 1 & 7), `README.md`
- Date: Intelligence Phase 1 (v0.1.0); index retuning planned Phase 7

## Context

Dedup needs fast cosine-similarity search over thousands of bug embeddings, multi-tenant-filtered. Postgres is already the primary store (see [0005](0005-core-data-plane-postgres-redis-s3.md)).

## Decision

Use the **pgvector** extension with an **IVFFlat** index on `bug_embeddings.embedding`, cosine distance (`<=>`), and composite indexes that include `tenant_id` for tenant-filtered search. Runs on `pgvector/pgvector:pg16`.

## Consequences

### Positive

- No separate vector database to operate; ACID guarantees; vectors co-located with relational data and tenant filters.

### Negative / Trade-offs

- IVFFlat may need retuning at scale (an explicit Phase 7 evaluation, including HNSW).
- Requires the pgvector extension in Postgres 16+.

## Alternatives considered

- **Dedicated vector DB** (e.g. Pinecone/Qdrant) — extra operational surface and egress. Rejected.
- **HNSW index** — under evaluation for Phase 7; IVFFlat chosen first for simplicity.
