# ADR-0026: Local BAAI/bge-m3 embeddings (self-hosted, multilingual)

- Status: Accepted
- Area: embeddings
- Source: `bugspotter-intelligence/services/embedding_service.py`, `Dockerfile`, `ROADMAP.md`
- Date: Intelligence Phase 1 (v0.1.0)

## Context

Semantic dedup needs embeddings. The product serves a multilingual market (EN/RU/KK), and external embedding APIs add per-call cost, latency, and a data-egress/compliance concern incompatible with self-hosting.

## Decision

Use **BAAI/bge-m3** (1024-dim) via `sentence-transformers`, generated **locally**. The model is **pre-downloaded into the Docker image** (see [0033](0033-offline-model-caching-docker.md)) for predictable cold starts. OpenAI `text-embedding-3-small` remains a configurable fallback for cloud deployments.

## Consequences

### Positive

- High-quality multilingual embeddings; no API cost or data egress; self-hostable and air-gappable.

### Negative / Trade-offs

- Docker image ~3GB; ~268ms latency per embedding on CPU.
- Embedding dimension (1024) must match `migrations.py` `target_dim`; switching models means re-embedding.

## Alternatives considered

- **OpenAI `text-embedding-3-small`** — kept as fallback, not default (cost/egress).
- **all-MiniLM-L6-v2 (384-dim)** — lower quality, weaker multilingual. Rejected.
