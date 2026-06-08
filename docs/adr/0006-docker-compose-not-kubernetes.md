# ADR-0006: Docker Compose single-host orchestration (not Kubernetes)

- Status: Accepted
- Area: infra / deployment
- Source: `bugspotter-deploy/docker-compose.yml`, `bugspotter-deploy/README.md`, `bugspotter-public/DOCKER.md`
- Date: Foundational

## Context

BugSpotter is deployed both as SaaS (on VMs) and self-hosted by customers ranging from one-person teams to small enterprises. Operators need something they can audit, modify, and debug without a platform team.

## Decision

**Docker Compose v2** is the orchestration and IaC. A base `docker-compose.yml` carries production-safe defaults (no infra ports exposed); an auto-loaded `docker-compose.override.yml` binds infra to `127.0.0.1` for dev. A root `Dockerfile` can also build a single unified image (supervisord running API + worker + nginx) for PaaS targets. Kubernetes is explicitly out of scope for now.

## Consequences

### Positive

- One YAML file per deployment shape; easy to inspect and change.
- In-place upgrades are `docker compose pull && docker compose up -d`.
- The unified-image option covers Railway/Render/Fly without changing source.

### Negative / Trade-offs

- Horizontal scaling needs a sidecar/reverse-proxy pattern; stateful services are single-replica unless manually backed up.
- Dev vs prod is a two-file model operators must understand (prod must exclude the override).

## Alternatives considered

- **Kubernetes** — CNCF-standard but over-specified for single-host installs (CRDs, RBAC, etcd operational burden). Deferred to a possible stage-2; not the right shape today.
- **systemd units** / **Terraform / Pulumi** — fragile or heavyweight for single-host. Rejected.
