# ADR-0033: Offline embedding-model caching in a multi-stage Docker image

- Status: Accepted
- Area: infra
- Source: `bugspotter-intelligence/Dockerfile`, `config.py`
- Date: Intelligence Phase 1 (v0.1.0)

## Context

If the bge-m3 model (see [0026](0026-local-bge-m3-embeddings.md)) is downloaded lazily on first request, cold starts are unpredictable and a lazy load can race a worker timeout into an OOM. Air-gapped deployments can't reach HuggingFace Hub at all.

## Decision

A **multi-stage Docker build** pre-downloads BAAI/bge-m3 in the builder stage; the runtime sets **`TRANSFORMERS_OFFLINE=1`** and **`HF_HUB_OFFLINE=1`** to forbid network calls. Production runs as a non-root user on `python:3.12-slim`.

## Consequences

### Positive

- Predictable startup (60s healthcheck start-period); no first-request download latency; works air-gapped.

### Negative / Trade-offs

- Image ~3GB (vs ~1GB without the model).
- The Dockerfile's model and `migrations.py` `target_dim` must be coordinated exactly (couples build to schema).

## Alternatives considered

- **Lazy loading** — smaller image but unpredictable starts and OOM race. Rejected.
- **Separate model volume** — extra provisioning step per host. Rejected in favor of baking it in.
