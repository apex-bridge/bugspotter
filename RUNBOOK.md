# Production Runbook (netcup SaaS host)

Covers the single production host at `app.kz.bugspotter.io` / `api.kz.bugspotter.io`
(netcup, `159.195.212.239`). This is **not** the self-hosted path - see
`DEPLOY-UPGRADE.md` for that. Written after the first fully-verified manual
deploy following the 2026-08-04 host move ([#309](https://github.com/apex-bridge/bugspotter/issues/309)),
recovering the sequence from the deleted `deploy-yandex.yml`
(`git show 97ccdec~1:.github/workflows/deploy-yandex.yml`) rather than
reconstructing it from memory.

## Host layout

`/opt/bugspotter/`:

| Path                                                                                | What                                                                            | Origin                                                                                                              |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/`                                                                              | Application source at the last-synced commit                                    | `git archive <ref> \| ssh ... tar -x` from a local clone - **not** a git clone on the host, there is no `.git` here |
| `docker-compose.yml`, `docker-compose.monitoring.yml`, `docker-compose.storage.yml` | The compose files actually in effect                                            | Synced from the repo **by hand**, separately from `src/` - see "Compose file drift" below                           |
| `.env`                                                                              | Runtime config + secrets                                                        | Hand-maintained on the host; never committed                                                                        |
| `monitoring/`                                                                       | Grafana/Prometheus/Alertmanager config, including hand-provisioned secret files | Partly synced, partly hand-created - see below                                                                      |
| `scripts/`                                                                          | `init-minio.sh`, `reset-demo-data.sh`, `seed-demo-data.sh`                      | Synced from repo                                                                                                    |
| `intelligence-src/`                                                                 | Separate source tree for the `bugspotter-intelligence` service                  | Same pattern as `src/`, different repo                                                                              |

`docker-compose.yandex.yml` no longer applies - it carried managed-Postgres
TLS/pooler plumbing for the decommissioned Yandex host and has no netcup
equivalent (Postgres runs as a container here, not a managed service).

## Compose file drift is real, not hypothetical

Checked 2026-08-11: the live `docker-compose.yml` and the copy already sitting
in a freshly-synced `src/` differed by **2253 diff lines** - looked like a
total rewrite. It wasn't: the live file has CRLF line endings (picked up from
some earlier Windows-side edit or transfer) while `git archive` always
produces LF, so every single line register as changed. `diff -B -b
--strip-trailing-cr` cuts through it. The _real_ diff was 2 comment lines (a
stale doc reference) in `docker-compose.yml`, a stale comment in
`docker-compose.monitoring.yml` - and one genuine functional difference in
`docker-compose.storage.yml`: the live file publishes the MinIO console to
`127.0.0.1:${MINIO_CONSOLE_PORT:-9001}:9001` for SSH-tunnel access; the
repo's copy does not. **Do not blindly overwrite the live storage compose
file from a fresh sync** - it would silently drop console access. Diff with
`--strip-trailing-cr` first, always.

## Update procedure (API/worker) - live-tested 2026-08-11

This is what actually ran to deploy PR #317's fix. `api` and `worker` share
one image (`bugspotter-api:latest`); rebuilding it without recreating both
leaves them on different code.

```bash
# 1. From a local clone at the target commit, sync source to the host.
#    git archive only includes tracked files - untracked cruft never leaks in.
#    This does NOT delete files removed from the repo since the last sync.
git archive main | ssh -i ~/.ssh/bugspotter-netcup root@159.195.212.239 \
  "tar -x -C /opt/bugspotter/src"

# 2. Build. The image is built directly with `docker build`, NOT `docker
#    compose build` - the live docker-compose.yml's `build.context: .` can't
#    resolve `packages/backend/Dockerfile` from /opt/bugspotter (there is no
#    /opt/bugspotter/packages). Compose only ever recreates containers from
#    an already-built, already-tagged image via `--no-build`.
ssh -i ~/.ssh/bugspotter-netcup root@159.195.212.239 "
  cd /opt/bugspotter/src
  docker build -f packages/backend/Dockerfile --target production \
    -t bugspotter-api:build-<short-ref> .
"

# 3. Tag the OLD image for rollback before overwriting :latest. This
#    pre-<ref>/build-<ref> convention already existed on the host (pre-290,
#    build-290, pre-292, build-292) before this runbook documented it.
ssh -i ~/.ssh/bugspotter-netcup root@159.195.212.239 \
  "docker tag bugspotter-api:latest bugspotter-api:pre-<short-ref>"

# 4. Retag the new build as :latest and recreate both containers that use it.
ssh -i ~/.ssh/bugspotter-netcup root@159.195.212.239 "
  docker tag bugspotter-api:build-<short-ref> bugspotter-api:latest
  cd /opt/bugspotter
  docker compose up -d --no-build api worker
"

# 5. Verify - external, not just container status (a green healthcheck can
#    still be checking the OLD deployment if step 4 silently no-oped).
curl -s -o /dev/null -w 'HTTP %{http_code}\n' https://app.kz.bugspotter.io/ready
ssh -i ~/.ssh/bugspotter-netcup root@159.195.212.239 \
  "docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}' | grep -E 'bugspotter-api|bugspotter-worker'"

# 6. Record what's deployed.
ssh -i ~/.ssh/bugspotter-netcup root@159.195.212.239 "
  cp /opt/bugspotter/.env /opt/bugspotter/.env.bak-gitcommit-<short-ref>
  sed -i 's/^GIT_COMMIT=.*/GIT_COMMIT=<short-ref>/' /opt/bugspotter/.env
"
```

**Rollback** (any step after 4 goes wrong):

```bash
ssh -i ~/.ssh/bugspotter-netcup root@159.195.212.239 "
  docker tag bugspotter-api:pre-<short-ref> bugspotter-api:latest
  cd /opt/bugspotter && docker compose up -d --no-build api worker
"
```

**Which containers need recreating for a given change** - `docker compose up
-d --no-build <service>` only touches containers whose image or config
actually changed:

| Change touches                                                                                                       | Recreate                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/backend/**`, `packages/types/**`, `packages/utils/**`, `packages/billing/**`, `packages/message-broker/**` | `api`, `worker` (shared image)                                                                                                                |
| `apps/admin/**`                                                                                                      | `admin` (separate image, separate Dockerfile - **not covered by this runbook**, no automated path exists for it either)                       |
| `docker-compose*.yml` only, no code change                                                                           | `docker compose up -d` for the affected service, no rebuild                                                                                   |
| `.env` only                                                                                                          | Depends on the variable - compose bakes interpolated env at container-**create** time, so most changes need `up -d` (recreate), not `restart` |

## Full stack bring-up / restore

Recovered from the deleted `deploy-yandex.yml`, adapted for netcup (drop the
`docker-compose.yandex.yml` overlay - no managed-DB TLS/pooler plumbing
needed here). **Not re-tested end-to-end during this session** - the update
procedure above was; this section is the recovered historical sequence, not
freshly verified.

```bash
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.monitoring.yml"

# Monitoring first - avoids port contention with core services, and pulling
# it alongside app images means --remove-orphans below won't mistake
# monitoring containers for orphans.
$COMPOSE --profile monitoring --profile host-metrics pull
$COMPOSE --profile monitoring --profile host-metrics up -d --no-build

# Core. --profile demo names the profile explicitly - a bare `up -d` silently
# skips every profiled service, including demo.
$COMPOSE --profile demo up -d --no-build --remove-orphans

# Intelligence, if used.
$COMPOSE --profile intelligence pull
$COMPOSE --profile intelligence up -d --no-build

# Health gate - internal first, then external (catches DNS/TLS-only breaks
# the internal check can't see).
for i in $(seq 1 15); do curl -sf http://127.0.0.1:3000/ready && break; sleep 10; done
curl -sf https://app.kz.bugspotter.io/ready
```

**Database / object storage restore**: see `BACKUP.md`'s restore drill for
fetching and validating a dump - that document deliberately restores into a
**scratch** database, not prod. For a live restore: stop `api` and `worker`
first (`docker compose stop api worker`), restore the dump into the running
`postgres` container, verify row counts before restarting, then `docker
compose up -d api worker`. MinIO/object-storage restore is not yet
documented anywhere - open gap, not covered by this runbook or by `BACKUP.md`.

## Hand-provisioned files (gitignored, not covered by any test)

- **`monitoring/telegram_token`** - must be owned `65534:65534` (the
  `nobody` user the alertmanager image runs as) with mode `600`. A
  root-owned file left by `cp`/`scp` as root is unreadable to the container -
  the healthcheck still passes and nothing logs until an alert actually
  fires and delivery silently fails. This exact failure was live in
  production after the 2026-08-04 move. Verified healthy on this host as of
  2026-08-11 (`nobody:nogroup`, mode `600`). Provision:
  ```bash
  printf '%s' '<bot-token>' > /opt/bugspotter/monitoring/telegram_token
  chown 65534:65534 /opt/bugspotter/monitoring/telegram_token
  chmod 600 /opt/bugspotter/monitoring/telegram_token
  ```
  Verify it's actually readable, not just present:
  ```bash
  docker exec bugspotter-alertmanager wc -c < /etc/alertmanager/telegram_token
  ```
- **`monitoring/alertmanager.yml`**'s `chat_id` field - substituted by hand
  from the deleted workflow's `TELEGRAM_ALERT_CHAT_ID`; no longer automated.

## Production env surface

`.env` on the host currently carries 87 variables. `.env.example` in the repo
does not enumerate all of them - these six in particular are load-bearing in
production and absent from `.env.example` (verified 2026-08-11, still true):

| Variable                      | Why it matters                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `DEPLOYMENT_MODE`             | `saas` vs `selfhosted` - gates multi-tenancy, billing, signup                                                                         |
| `DATA_RESIDENCY_REGION`       | Sets the residency column on new organisations at creation time                                                                       |
| `COOKIE_DOMAIN`               | Unset silently breaks cross-subdomain SSO                                                                                             |
| `SELF_SERVICE_SIGNUP_ENABLED` | Gates the signup endpoint in `saas` mode                                                                                              |
| `POSTGRES_HOST`               | Points at the in-network `postgres` container - required since there's no managed DB here                                             |
| `NODE_EXTRA_CA_CERTS`         | Was needed for the old managed-Postgres TLS chain; **not set on this host** - confirms it's Yandex-era-only, not a netcup requirement |

Full production var set is not reproduced here (values are secrets); this
table is the delta between what's live and what the repo documents.

## Related

- `BACKUP.md` - off-site backup mechanics and the scratch-DB restore drill
- `DEPLOY-UPGRADE.md` - self-hosted image pinning and upgrade order (different scope)
- [#309](https://github.com/apex-bridge/bugspotter/issues/309) - the issue this runbook closes
- [#318](https://github.com/apex-bridge/bugspotter/issues/318) - `deploy-api.yml` never actually deploying; this runbook is its documented input
