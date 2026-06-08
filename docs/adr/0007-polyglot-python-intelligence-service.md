# ADR-0007: Polyglot — separate Python intelligence service over HTTP + circuit breaker

- Status: Accepted
- Area: architecture / integration
- Source: `bugspotter-public/packages/backend/docs/architecture.md`, `bugspotter-intelligence/README.md`, `ONBOARDING.md`
- Date: Foundational to the AI tier

## Context

Duplicate detection and enrichment need ML (embeddings, LLM reranking). The core backend is TypeScript; the AI/ML ecosystem (sentence-transformers, pgvector tooling) is Python-native. Coupling ML into the Node process would force language compromises and tie failure domains together.

## Decision

Run a **separate Python FastAPI service** (`bugspotter-intelligence`) decoupled from the backend via **HTTP + a circuit breaker**. The backend degrades gracefully (dedup/enrichment skipped) when the intelligence service is unavailable.

## Consequences

### Positive

- Independent scaling and language choice for ML; failure isolation via circuit breaker.
- The AI tier is optional (see [0033](0033-offline-model-caching-docker.md) and the deploy `--profile intelligence`).

### Negative / Trade-offs

- **Schema must stay in lockstep across repos**: the `DedupRule` shape is defined as Zod (TS) and Pydantic (Python) and the two must not drift.
- Network latency on dedup calls; an extra service to deploy and observe.

## Alternatives considered

Not recorded in docs. Embedding ML inside the Node backend was implicitly rejected for the language and failure-isolation reasons above.
