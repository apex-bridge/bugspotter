# Deploy & Upgrade Runbook

For self-hosted deployments running the Docker Compose stack. Covers
image pinning and the safe upgrade order. Read alongside `DOCKER.md`.

## Image pinning

Every BugSpotter application service image (listed below) resolves from an
environment variable with a `:latest` fallback intended only for local
development. Third-party infrastructure images (Postgres/Redis/MinIO and the
monitoring stack) are pinned directly in `docker-compose.yml`, not via these
variables:

| Service      | Variable             | Default                          | Profile      |
| ------------ | -------------------- | -------------------------------- | ------------ |
| api          | `API_IMAGE`          | `bugspotter-api:latest`          | always on    |
| worker       | `WORKER_IMAGE`       | `bugspotter-api:latest`          | always on    |
| admin        | `ADMIN_IMAGE`        | `bugspotter-admin:latest`        | always on    |
| payment      | `PAYMENT_IMAGE`      | `bugspotter-payment:latest`      | always on    |
| demo         | `DEMO_IMAGE`         | `bugspotter-demo:latest`         | demo         |
| intelligence | `INTELLIGENCE_IMAGE` | `bugspotter-intelligence:latest` | intelligence |
| ollama       | `OLLAMA_IMAGE`       | `ollama/ollama:latest`           | intelligence |

The `demo`, `intelligence`, and `ollama` images only ship when their profile is
enabled (`--profile demo` / `--profile intelligence`); pin them only if you run
those profiles.

`:latest` is mutable - two deploys weeks apart can pull different binaries. For a
reproducible deployment, pin every variable in `.env` to an immutable reference,
preferably a digest:

```dotenv
API_IMAGE=registry.example/bugspotter-api@sha256:<digest>
WORKER_IMAGE=registry.example/bugspotter-api@sha256:<digest>
ADMIN_IMAGE=registry.example/bugspotter-admin@sha256:<digest>
PAYMENT_IMAGE=registry.example/bugspotter-payment@sha256:<digest>
DEMO_IMAGE=registry.example/bugspotter-demo@sha256:<digest>
INTELLIGENCE_IMAGE=registry.example/bugspotter-intelligence@sha256:<digest>
OLLAMA_IMAGE=ollama/ollama@sha256:<digest>
```

Resolve a tag to its digest with `docker buildx imagetools inspect <image:tag>`
or `docker inspect --format='{{index .RepoDigests 0}}' <image:tag>` after pull.

## Upgrade order

Migrations are **forward-only** (no down-migrations). Roll back by redeploying a
previous image, not by reversing a migration - so take a database backup before
upgrading if the release includes schema changes.

1. **Back up** the database (or confirm the managed-Postgres automatic backup is
   current and restorable).
2. **Update the pins** in `.env` to the new digests.
3. **Pull** the new images: `docker compose pull`.
4. **Run migrations**: `docker compose run --rm api pnpm --filter @bugspotter/backend migrate`.
   Migrations are idempotent and skip already-applied entries.
5. **Restart** services: `docker compose up -d`.
6. **Verify**: `GET /health` and `GET /ready` return 200; check container logs.

## Rollback

1. Restore the previous digests in `.env`.
2. Stop the running services: `docker compose down`.
3. If the failed release applied a schema migration, restore the pre-upgrade
   database backup **before** starting the previous version - a newer forward
   migration cannot be undone in place, and letting the old code run against the
   upgraded schema risks further corruption.
4. `docker compose pull && docker compose up -d`.

## Notes

- The `demo` service is opt-in (`--profile demo`) and pulls third-party CDN
  assets; do not enable it in a data-localized deployment.
- The AI stack (`intelligence`, `ollama`) is behind `--profile intelligence` and
  is optional; the platform runs with `INTELLIGENCE_ENABLED=false`.
