# ADR-0037: Dual-mode MCP transport (stdio + HTTP)

- Status: Accepted
- Area: mcp-transport
- Source: `bugspotter-mcp/README.md`, `package.json` (bin entries), `docs/architecture.md`, `deploy/DEPLOYMENT.md`
- Date: MCP v0.3.0 (HTTP added)

## Context

AI agents consume BugSpotter in two shapes: individuals running a per-user subprocess (Claude Code, Cursor, desktop), and teams wanting a hosted multi-tenant endpoint. One transport can't serve both efficiently.

## Decision

Ship two entry points from one codebase: **`bugspotter-mcp`** (stdio, per-user, key in the environment) and **`bugspotter-mcp-http`** (HTTP, multi-tenant, each request carrying `Authorization: Bearer bgs_<key>`). HTTP sessions are stateful and in-process with a 30-minute inactivity TTL; clients echo an `Mcp-Session-Id` bound to their bearer token (mismatch → 403).

## Consequences

### Positive

- Stdio keeps the key local and is trivial for desktop clients; HTTP multiplexes many users on one process.

### Negative / Trade-offs

- HTTP mode is stateful → **sticky routing required** at scale (LB routes on `Mcp-Session-Id`).
- Operators must choose the deployment shape upfront; reverse proxies need a 600s read timeout and disabled buffering for long `ask` (LLM) calls and SSE.

## Alternatives considered

- **Single unified transport** — precludes efficient multi-user hosting. Rejected.
- **Custom protocol** — reinvents what the MCP spec already standardizes. Rejected.
