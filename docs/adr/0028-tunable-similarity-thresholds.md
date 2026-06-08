# ADR-0028: Tunable similarity thresholds (0.68 / 0.85), per-tenant

- Status: Accepted
- Area: dedup
- Source: `bugspotter-intelligence/config.py`, `ROADMAP.md` (Phase 1)
- Date: Intelligence Phase 1 (v0.1.0)

## Context

Embedding similarity must be turned into a yes/no "is this a duplicate?" decision. The right cut-off depends on the embedding model's space and on a customer's tolerance for false merges, so it can't be a single universal constant.

## Decision

Two configurable thresholds, defaulting to values empirically tuned for bge-m3: **`similarity_threshold = 0.68`** (related/similar) and **`duplicate_threshold = 0.85`** (auto-duplicate). Tunable per-tenant. Responses expose `threshold_used` for transparency.

## Consequences

### Positive

- Customers can tune precision/recall after deployment without a code change.
- Exposing `threshold_used` makes dedup decisions auditable.

### Negative / Trade-offs

- Thresholds are **model-specific** — a different embedding model (e.g. OpenAI) requires re-tuning (couples to [0026](0026-local-bge-m3-embeddings.md)).

## Alternatives considered

- **Fixed thresholds** — can't adapt to customer tolerance or model changes. Rejected.
