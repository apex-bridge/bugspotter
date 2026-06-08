# ADR-0039: Ajv + JSON Schema validation (single source of truth)

- Status: Accepted
- Area: mcp-tools
- Source: `bugspotter-mcp/docs/architecture.md` (Design decisions: "Why JSON Schema + Ajv?")
- Date: MCP v0.1.0

## Context

The MCP spec mandates that each tool's `inputSchema` is **JSON Schema** sent over the wire. Tool arguments must be validated at dispatch, and the validation must not drift from what the agent sees.

## Decision

Validate with **Ajv against the same JSON Schema** that is published on the wire — one source of truth. No separate code-level schema (e.g. Zod) that would have to be kept in sync with the wire schema.

## Consequences

### Positive

- The schema the agent sees **is** the schema that validates — no drift; tweaks are immediately visible to agents.
- Ajv errors are format-exact, feeding precise behavioral logs (validation class, `args_size_bytes`).

### Negative / Trade-offs

- JSON Schema is more verbose to author by hand than a Zod schema with inferred types.

## Alternatives considered

- **Zod with codegen to JSON Schema** — adds a build step and a sync failure mode. Rejected.
- **Manual validation** — error-prone. Rejected.
- **TypeScript types only** — no runtime checks. Rejected.
