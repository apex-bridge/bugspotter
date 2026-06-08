# ADR-0032: AI observability — `intelligence_event` + `intelligence_feedback`

- Status: Accepted (observability Phase 1; rollout planned)
- Area: observability
- Source: `bugspotter-intelligence/docs/ai-observability-design.md`, `db/migrations.py`
- Date: Intelligence Phase 7 (v0.7.0, production hardening)

## Context

Every LLM call needs auditing (tokens, latency, cost, confidence) and a way to measure decision quality over time, per tenant — and multiple reviewers may disagree about whether a given AI decision was correct.

## Decision

Two tables:

- **`intelligence_event`** — immutable audit record per LLM call (token counts, latency, `cost_micros_usd` from a `MODEL_PRICING` map, status, confidence, rationale capped at 4 KiB, `meta` JSONB).
- **`intelligence_feedback`** — user verdicts (correct / incorrect / partial) with `event_id` FK and `user_ref` for multi-reviewer consensus; `tenant_id` denormalized for fast per-tenant aggregation.

Three call sites (reranker, rule parser, `ask`) are wrapped with `record_generate()`; `generate_with_usage()` on the provider base class (see [0029](0029-llm-provider-abstraction-ollama-default.md)) supplies the token data. Admin endpoints `/observability/{summary,events,accuracy}` require an admin key.

## Consequences

### Positive

- Events stay immutable while feedback accumulates separately; reviewers can disagree without mutating the audit record.
- Cost and accuracy are measurable per tenant — the basis for the AI eval/monitoring roadmap.

### Negative / Trade-offs

- Two new tables and write-path wrapping at each call site; `meta` JSONB is intentionally un-GIN-indexed (kept lean).

## Alternatives considered

- **Single table with feedback columns** — pollutes the immutable audit record. Rejected.
- **No feedback capture** — can't measure accuracy. Rejected.
