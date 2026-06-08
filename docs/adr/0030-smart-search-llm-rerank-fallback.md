# ADR-0030: Smart search — LLM rerank with timeout fallback

- Status: Accepted
- Area: ml-model / search
- Source: `bugspotter-intelligence/services/reranker.py`, `config.py`
- Date: Intelligence Phase 3 (v0.3.0)

## Context

Pure vector search returns nearest neighbors that aren't always the most _relevant_ results. LLM reranking improves quality but is slow and can hang, so it can't sit on the critical path unguarded.

## Decision

`POST /api/v1/search` with **`mode=smart`** retrieves the top-20 candidates via pgvector, has the LLM score relevance (0.0–1.0), and returns the top-5 reranked. A **10s timeout** falls back to the raw vector results if the LLM is slow/unavailable. `mode=fast` skips reranking entirely. Candidate and return limits are configurable.

## Consequences

### Positive

- Better relevance without model retraining; graceful degradation to vector-only on timeout.
- Callers choose the cost/latency trade-off per query (`fast` vs `smart`).

### Negative / Trade-offs

- Smart mode adds latency (sub-1s typical, up to 10s on timeout) and LLM cost per search.
- Timeout must be tuned per deployment/model.

## Alternatives considered

- **Vector-only search** — kept as `mode=fast`; insufficient as the only mode for relevance.
