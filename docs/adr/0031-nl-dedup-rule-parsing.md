# ADR-0031: Natural-language dedup-rule parsing via few-shot JSON

- Status: Accepted
- Area: prompt / dedup
- Source: `bugspotter-intelligence/services/rule_parser_service.py`
- Date: Rules pipeline (Phase 0.5 / Phase 4+ integration)

## Context

Operators want to describe dedup rules in plain English ("merge crashes from the same stack trace into one ticket"), but the engine needs a validated structured `DedupRule` (triggers / conditions / actions).

## Decision

A **few-shot system prompt** defines the ontology and covers the B1/B2/B3 persona cases plus an ambiguous case. Generation runs at **low temperature (0.1)** for determinism; available integrations are injected as context so the LLM doesn't invent targets. Output is extracted from markdown fences with a **character-level brace counter** (handles arbitrary nesting), then **validated with Pydantic**; validation failures return a `null` draft plus a `clarifications` list.

## Consequences

### Positive

- Operators author rules in natural language; structured output is schema-validated before it touches the engine.
- Injecting real integrations prevents hallucinated targets.

### Negative / Trade-offs

- Operator experience depends on prompt quality; ambiguous input yields clarification requests rather than a rule.
- The NL endpoint is kept but full pipeline integration was **deferred** (see project notes); the executor is the load-bearing path.

## Alternatives considered

- **Regex-based parsing** — brittle. Rejected.
- **Chain-of-thought** — verbose, less deterministic for JSON extraction. Rejected in favor of low-temp few-shot.
