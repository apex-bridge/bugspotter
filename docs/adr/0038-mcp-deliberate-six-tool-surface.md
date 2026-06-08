# ADR-0038: Deliberate six-tool MCP surface

- Status: Accepted
- Area: mcp-tools
- Source: `bugspotter-mcp/docs/architecture.md` (Design decisions), `README.md` (tool table)
- Date: MCP v0.1.0

## Context

No MCP server exists for a bug tracker yet (no precedent). Exposing too much overloads the agent's choice space and creates write-blast-radius liability; exposing too little frustrates real triage workflows.

## Decision

Exactly **six tools**, grouped by triage-workflow frequency: `search_bugs`, `find_similar`, `ask` (discovery); `get_bug`, `list_bugs` (inspection); **`update_bug_status`** (the single write). Omissions are deliberate: `create_bug` (high blast radius without human gates), `add_comment` (no backend table yet), `attach_session_replay` (needs multi-step presigned URLs), `suggest_fix` (async-polling, doesn't map to one MCP call).

## Consequences

### Positive

- A small, workflow-aligned surface agents can reason about; exactly one write keeps liability bounded.
- Behavioral logs (see [0040](0040-mcp-behavioral-jsonl-logging.md)) reveal how agents use the surface (over-drilling, under-using `ask`).

### Negative / Trade-offs

- Tool descriptions must be precise — agents get validation errors if they misread the `mode` enum or required fields.
- Closure workflows that need create/comment aren't fully served yet (intentional, revisitable).

## Alternatives considered

- **Full CRUD** — dangerous writes. Rejected.
- **Read-only** — frustrates status-closure workflows. Rejected.
