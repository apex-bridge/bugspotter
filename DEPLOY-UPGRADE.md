# Deploy & Upgrade Runbook

For partner / self-hosted deployments running the Docker Compose stack. Covers
image pinning and the safe upgrade order. Read alongside `DOCKER.md`.

## Image pinning

Every service image resolves from an environment variable with a `:latest`
fallback intended only for local development:

| Service      | Variable             | Default                          |
| ------------ | -------------------- | -------------------------------- |
| api          | `API_IMAGE`          | `bugspotter-api:latest`          |
| worker       | `WORKER_IMAGE`       | `bugspotter-api:latest`          |
| admin        | `ADMIN_IMAGE`        | `bugspotter-admin:latest`        |
| payment      | `PAYMENT_IMAGE`      | `bugspotter-payment:latest`      |
| intelligence | `INTELLIGENCE_IMAGE` | `bugspotter-intelligence:latest` |
| ollama       | `OLLAMA_IMAGE`       | `ollama/ollama:latest`           |

`:latest` is mutable - two deploys weeks apart can pull different binaries. For a
reproducible deployment, pin every variable in `.env` to an immutable reference,
preferably a digest:

```
API_IMAGE=registry.example/bugspotter-api@sha256:<digest>
WORKER_IMAGE=registry.example/bugspotter-api@sha256:<digest>
ADMIN_IMAGE=registry.example/bugspotter-admin@sha256:<digest>
PAYMENT_IMAGE=registry.example/bugspotter-payment@sha256:<digest>
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
2. `docker compose pull && docker compose up -d`.
3. If the failed release applied a schema migration, restore the pre-upgrade
   database backup - a newer forward migration cannot be undone in place.

## Notes

- The `demo` service is opt-in (`--profile demo`) and pulls third-party CDN
  assets; do not enable it in a data-localized deployment.
- The AI stack (`intelligence`, `ollama`) is behind `--profile intelligence` and
  is optional; the platform runs with `INTELLIGENCE_ENABLED=false`.
