# ADR-0002: Fastify / TypeScript backend as the API core

- Status: Accepted
- Area: backend
- Source: `bugspotter-public/CLAUDE.md`, `packages/backend/`
- Date: Foundational (not precisely dated)

## Context

The platform needs an HTTP API for SDK ingest, the admin dashboard, billing, and integrations, plus a background worker. It must be type-safe end to end against the shared `@bugspotter/types`.

## Decision

Build the API and worker as a **TypeScript Fastify** application in `packages/backend`, with the worker sharing the same codebase (separate `worker:dev` / `worker:start` entry points) rather than a separate service.

## Consequences

### Positive

- Schema-based validation and serialization fit Fastify's model; JSON Schema is reused at the edge.
- One codebase for API + worker simplifies type sharing and deployment (see [0006](0006-docker-compose-not-kubernetes.md)).
- `test:unit` runs without Docker; `test:integration` needs the dev stack.

### Negative / Trade-offs

- API and worker share a dependency surface even though they scale differently; separation is by process, not by package.

## Alternatives considered

Not recorded in docs (no Express-vs-Fastify rationale is written down). Recorded here so the stack choice is traceable; revisit this ADR if the framework is reconsidered.
