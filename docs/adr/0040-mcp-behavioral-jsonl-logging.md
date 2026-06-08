# ADR-0040: Behavioral JSONL logging with scoped PII redaction

- Status: Accepted
- Area: mcp-tools / observability
- Source: `bugspotter-mcp/docs/behavioral-logs.md`, `docs/architecture.md` (Design decisions)
- Date: MCP v0.1.0

## Context

The MCP server doubles as a research artifact: a record of how AI agents reason about a bug tracker. That requires logging every tool call without leaking the PII users paste into free-text fields, and without a concurrency hazard under multi-user HTTP.

## Decision

Log **one JSONL record per tool dispatch**, daily-rotated. Apply **PII redaction (emails, JWTs, credit cards) only to free-text args** (`search_bugs`, `ask`) — not to schema-enforced fields (UUIDs, enums), where redaction would be a category error. The session id is `sha256(api_key)[:32]`, never the raw key. Result **bodies are not logged** (privacy); `result_count` distinguishes `null` ("not meaningful") from `0` ("empty").

## Consequences

### Positive

- Append-only JSONL is concurrency-safe under multi-user SaaS and trivially aggregated (`jq`).
- Enables agent-behavior research while protecting pasted PII and result contents.

### Negative / Trade-offs

- No result bodies means some analyses need the backend instead.
- Redaction is intentionally partial (free-text only) — relies on the schema to keep PII out of structured fields.

## Alternatives considered

- **Structured logs to an external backend** — loses data locality, adds a dependency. Rejected.
- **No logging** — makes the research goal impossible. Rejected.
- **Universal PII redaction** — wasteful on schema-enforced fields. Rejected.
