# ADR-0003: Dual licensing — FSL-1.1-Apache-2.0 platform, MIT SDK

- Status: Accepted
- Area: licensing
- Source: `bugspotter-public/LICENSE.md`, `bugspotter-sdk/LICENSE`, `README.md`, `CONTRIBUTING.md`
- Date: Decided at first release; platform license converts to Apache 2.0 on **2028-04-09**

## Context

The business needs commercial sustainability (prevent a competitor from reselling the platform as a SaaS) while still allowing customers to self-host, inspect, and modify — and the embeddable SDK must carry zero licensing friction because it runs inside third-party apps.

## Decision

Two licenses by component:

- **Platform** (backend, admin, intelligence, and the rest): **FSL-1.1-Apache-2.0** (Functional Source License) — source-available, no competing-SaaS use, **auto-converts to Apache 2.0 on 2028-04-09**.
- **SDK** (`@bugspotter/sdk`): **MIT** — so customers can bundle it freely.

## Consequences

### Positive

- Self-hosting, internal use, and contributions are allowed today; the Apache-2.0 future date removes any forced re-licensing decision later.
- The SDK has no adoption friction.

### Negative / Trade-offs

- Two license regimes to track; contributor terms differ by repo (CONTRIBUTING.md must state FSL for the platform).
- "Open-source platform" is an inaccurate description until 2028 — only the SDK is OSI-open. Public/marketing copy must say "source-available."

## Alternatives considered

- **MIT everywhere** — would permit a competing managed service. Rejected.
- **Fully proprietary** — locks out self-hosting and community. Rejected.
- **Pure Apache 2.0 now** — gives up the competing-SaaS protection during the commercial window. Deferred to 2028 via FSL's change date.
