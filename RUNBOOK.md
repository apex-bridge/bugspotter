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

| Path                                                                                | What                                                                                                                                                                                   | Origin                                                                                                              |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/`                                                                              | Application source at the last-synced commit                                                                                                                                           | `git archive <ref> \| ssh ... tar -x` from a local clone - **not** a git clone on the host, there is no `.git` here |
| `docker-compose.yml`, `docker-compose.monitoring.yml`, `docker-compose.storage.yml` | The compose files actually in effect                                                                                                                                                   | Synced from the repo **by hand**, separately from `src/` - see "Compose file drift" below                           |
| `.env`                                                                              | Runtime config + secrets                                                                                                                                                               | Hand-maintained on the host; never committed                                                                        |
| `monitoring/`                                                                       | Grafana/Prometheus/Alertmanager config, including hand-provisioned secret files                                                                                                        | Partly synced, partly hand-created - see below                                                                      |
| `scripts/`                                                                          | `init-minio.sh`, `reset-demo-data.sh`, `seed-demo-data.sh` (synced) plus `ci-deploy.sh`, `poll-deploy.sh` and their state/lock/log files (host-only, `deploy`-owned - not in the repo) | Mixed: repo-synced files and hand-created ops tooling share this directory                                          |
| `intelligence-src/`                                                                 | Separate source tree for the `bugspotter-intelligence` service                                                                                                                         | Same pattern as `src/`, different repo                                                                              |

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

## Three deploy paths now exist - which one actually runs

The manual procedure above is one of three. As of 2026-08-11/12, in order of
how automatic each is:

1. **Manual** (above) - a human runs it by hand. Always works, always current.
2. **SSH forced-command, CI-triggered** - `deploy-api.yml`'s `deploy-production`
   job SSHes in as a dedicated `deploy` account restricted to one script
   (`ci-deploy.sh`); see `DEPLOY-SECRETS-ROTATION.md`. **Currently non-functional**:
   GitHub-hosted runner IPs time out reaching `159.195.212.239:22`, blocked
   somewhere upstream of the host's own firewall (`ufw` allows it; the block
   isn't visible from inside the VM). `workflow_dispatch`-only, never fires on
   push, so this is safe to leave broken - it just means it isn't doing
   anything, not that it's doing the wrong thing.
3. **Poll-based, host-side** (`poll-deploy.sh`, this section) - the fix for
   (2)'s blocker: instead of GitHub reaching in, the host reaches out. No
   inbound network dependency at all.

### Poll-based auto-deploy

`ghcr.io/apex-bridge/bugspotter/api` is a **public** package - confirmed
2026-08-11 via `docker manifest inspect` with zero credentials. Combined with
the host already having working outbound internet (proven the same day: it
pulled from GHCR fine during manual testing), there is no reason to fight the
inbound-firewall problem at all for routine deploys. The host can just check
the registry itself.

`/opt/bugspotter/scripts/poll-deploy.sh`, owned by `deploy`, run every 3
minutes via that user's crontab:

```sh
#!/bin/sh
set -eu

IMAGE="ghcr.io/apex-bridge/bugspotter/api:main"
STATE_FILE="/opt/bugspotter/scripts/.last-deployed-digest"
LOCK_FILE="/opt/bugspotter/scripts/.poll-deploy.lock"
LOG_FILE="/opt/bugspotter/scripts/.poll-deploy.log"

exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

pull_output=$(docker pull "$IMAGE")
new_digest=$(printf '%s\n' "$pull_output" | awk '/^Digest: sha256:/{print $2}')

if [ -z "$new_digest" ]; then
  echo "$(date -Iseconds) could not parse a digest from docker pull output, skipping" >> "$LOG_FILE"
  exit 1
fi

old_digest=$(cat "$STATE_FILE" 2>/dev/null || true)

[ "$new_digest" = "$old_digest" ] && exit 0

echo "$(date -Iseconds) deploying $new_digest (was: ${old_digest:-none})" >> "$LOG_FILE"

short=$(printf '%s' "$new_digest" | cut -c1-12)
docker tag bugspotter-api:latest "bugspotter-api:pre-$short" 2>/dev/null || true
docker tag "$IMAGE" bugspotter-api:latest
cd /opt/bugspotter
docker compose up -d --no-build api worker

printf '%s' "$new_digest" > "$STATE_FILE"
echo "$(date -Iseconds) deployed $new_digest" >> "$LOG_FILE"
```

Crontab (installed for the `deploy` user, not root):

```
*/3 * * * * /opt/bugspotter/scripts/poll-deploy.sh
```

**Two bugs found and fixed while building this, both worth knowing if this
script is ever touched again:**

- `deploy` cannot create files directly in `/opt/bugspotter/` - that
  directory is `root:root` mode `755`. State/lock/log files live in
  `/opt/bugspotter/scripts/` instead, which `deploy` owns (same directory
  `ci-deploy.sh` already lives in).
- The digest **must** come from `docker pull`'s own `Digest: sha256:...`
  output line, not from `docker inspect --format='{{index .RepoDigests 0}}'`.
  `RepoDigests` is an unordered list of every repo@digest pairing a locally
  cached image is known under - if the same image content is ever reachable
  through more than one tag, index `0` is not guaranteed to be the one
  belonging to `$IMAGE`. Caught this the hard way: a second run that should
  have been a silent no-op instead redeployed, because the wrong list entry
  won the race.

Deploying `:main` specifically (not `:latest`) means only pushes that
actually rebuild the backend move it - `docker/metadata-action`'s
`type=ref,event=branch` only retags `:main` when a real build runs, same
gating as everything else in `deploy-api.yml`.

**Interaction with path (2):** unaffected. If netcup's firewall question ever
gets resolved, both paths can run side by side - the SSH path deploys
on-demand and immediately; the poller deploys automatically within its
interval. They converge on the same state (`bugspotter-api:latest`) via the
same underlying tag-and-recreate pattern, so there's no conflict between
them, only redundancy.

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
