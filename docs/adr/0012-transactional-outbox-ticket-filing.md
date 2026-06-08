# ADR-0012: Transactional outbox for external ticket filing

- Status: Accepted
- Area: data / integration
- Source: `bugspotter-public/packages/backend/docs/architecture.md`, `db-schema.md` (migrations 001, 021)
- Date: Foundational (001); dedup-grace enhancement (021)

## Context

Creating a bug report and filing an external ticket (Jira/Linear/webhook) must not produce duplicate tickets on retry, but filing is async and can fail. Inline synchronous filing couples ingest to third-party uptime.

## Decision

File tickets through a **`ticket_creation_outbox`** table (transactional-outbox pattern). A row is inserted in the **same transaction** as the bug report; a worker polls and advances a state machine. An `idempotency_key` prevents duplicates. A **dedup grace window** (migration 021) lets the intelligence service mark duplicates _before_ filing proceeds.

## Consequences

### Positive

- Decouples ingest from integration filing; exactly-once semantics for external systems.
- Retries are safe; the dedup grace window avoids filing tickets for soon-to-be-merged duplicates.

### Negative / Trade-offs

- Extra table, worker polling overhead, and state-machine logic to maintain.

## Alternatives considered

- **Inline synchronous filing** — tight coupling, cascading failures. Rejected.
- **Naive async** (fire-and-forget) — duplicate tickets on retry. Rejected.
