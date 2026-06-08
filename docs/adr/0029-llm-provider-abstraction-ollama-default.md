# ADR-0029: LLM provider abstraction; Ollama `llama3.2:3b` default

- Status: Accepted
- Area: ml-model
- Source: `bugspotter-intelligence/llm/factory.py`, `llm/base.py`, `llm/ollama.py`, `README.md`, `ROADMAP.md`
- Date: Intelligence Phase 1 (v0.1.0); cloud providers Phase 4+

## Context

The AI tier needs LLM inference for reranking, rule parsing, and Q&A. Self-hosted/air-gapped deployments need a local, GPU-free option; production SaaS may prefer a stronger hosted model. The code must not hard-wire one vendor.

## Decision

An abstract **`LLMProvider`** base class with a **factory + registry** (`register_provider` decorator); the factory instantiates a provider from settings. Every provider implements `generate()` and **`generate_with_usage()`** (token counts for observability — see [0032](0032-ai-observability-event-feedback-tables.md)). **Ollama (`llama3.2:3b`)** is the default for dev/self-hosted (CPU-only); Claude Sonnet is recommended for production (Phase 4+). Ollama and Claude/OpenAI are configured; Ollama is fully implemented.

## Consequences

### Positive

- New providers register themselves without touching the factory; all expose token usage uniformly.
- Local default avoids GPU cost (~$1–3K/mo) and enables air-gapped installs.

### Negative / Trade-offs

- `llama3.2:3b` is lower quality than GPT-4o/Sonnet; ~120s Ollama timeout (`OLLAMA_TIMEOUT` tunable).
- Claude/OpenAI providers are configured but not yet fully implemented (Phase 4 work).

## Alternatives considered

- **Conditional import/instantiation per vendor** — scatters vendor logic, hard to extend. Rejected for the registry pattern.
- **Cloud-only LLM** — breaks air-gapped/self-hosted. Rejected as default.
