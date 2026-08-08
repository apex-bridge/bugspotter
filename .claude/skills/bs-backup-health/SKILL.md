---
name: bs-backup-health
description: Check whether BugSpotter production backups in the off-site bucket are fresh and restorable. Reports last-backup timestamps per data source (main Postgres, intelligence-db, object storage), validates file size sanity, surfaces stale or missing backups with remediation suggestions. TRIGGER when user asks about backup status, backup health, "проверь бэкапы", DR readiness; before running a migration drill; before production migration; as a weekly health check.
---

# bs-backup-health

Verifies that BugSpotter prod data is safely backed up to the off-site,
S3-compatible backup bucket and ready for restoration. **Does NOT modify
anything** — read-only inspection.

## When to invoke

- User asks about backup state (any phrasing: "backups", "бэкапы", "data safety", "DR readiness", "backup freshness")
- Before any migration operation: drill, precheck, production migration
- After deploying changes to the `backup` profile in `docker-compose.yml`
- Weekly/monthly ops review

## Prerequisites (always check first)

### Step 1 — Is backup infrastructure even deployed?

Grep `docker-compose.yml` and `docker-compose.*.yml` for a service named `pg-backup` (or any service under `profiles: [backup]`).

- **If NOT found** → backup not yet implemented. Output:

  > Backup infrastructure not yet deployed in this repo. The plan is in `multi-cloud-architecture.html` and `migration-strategy.html` Phase 1. Cannot check health of something that doesn't exist.

  STOP. Do not attempt further checks.

- **If found** → continue.

### Step 2 — Identify the backup bucket

From `.env`, `docker-compose.yml`, or the deploy secret store, extract:

- `BACKUP_S3_BUCKET` (default: `bugspotter-backups`)
- `BACKUP_S3_ENDPOINT` (whatever S3-compatible endpoint the operator configured)

Report which provider/endpoint is being used so the user has context.

### Step 3 — Credentials availability

- If `aws` CLI exists locally AND `BACKUP_S3_ACCESS_KEY` is set → run checks directly via Bash.
- If credentials are only on prod VM → output the commands for the user to run on prod, ask them to paste output.

**Never** print full secret keys back to the user.

### Step 4 — Source-side tooling

The object-count parity check (below) counts objects in the **source** bucket,
which is whatever `S3_ENDPOINT` points at - MinIO on the application host in the
single-box topology, or a provider's object storage. Both speak S3, so `aws s3`
with an explicit `--endpoint-url` covers either; no provider CLI is needed.

- Read the source endpoint and bucket from the deployment's `.env`: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`. These are the source credentials, distinct from the `BACKUP_S3_*` set used for the off-site side.
- **The `aws` CLI does not read those names.** It looks for `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, so each command below must be given the right pair explicitly. Leaving them unset does not fail cleanly: the CLI falls back to whatever profile, instance role or `~/.aws/credentials` the machine happens to have, and can return an object count for a completely different account - a wrong parity number is worse than a missing one. The two sides use different credentials, so never export one pair for both.
- **Do not skip this check when a provider CLI is absent.** A skipped parity check reports as "not verified" and is easy to read as "fine", which is how a backup stream that copies nothing looks identical to one that is healthy. If `aws` is unavailable locally, output the command for the user to run on the host rather than dropping the check.
- MinIO's own client (`mc`) is an alternative when it is already installed on the host: `mc ls --recursive --summarize <alias>/<bucket> | tail -1`.

## Procedure

Check three backup sources in order. For each, report Status (OK / STALE / MISSING / CORRUPT), latest file, age, size.

Every command below reads the off-site bucket, so each needs the `BACKUP_S3_*`
credentials passed under the names the `aws` CLI actually reads (Step 4). To
avoid repeating them, set them once for the off-site side of this session:

```bash
export AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY}"
export AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY}"
```

The parity check later reads the _source_ bucket, which uses different
credentials - it passes them inline rather than relying on this export.

### A. Main Postgres backup

```bash
aws s3 ls s3://${BACKUP_S3_BUCKET}/postgres/ \
  --endpoint-url=${BACKUP_S3_ENDPOINT} \
  --recursive | sort | tail -5
```

Validate:

- **Freshness:** latest file 12 hours old or less (pg-backup runs every 6h; 12h means we missed a cycle). These thresholds assume the default 6h cadence; if the deployment raised `BACKUP_INTERVAL_SECONDS` (see `docker-compose.yml`), scale the freshness window to about 2x the configured interval before flagging STALE.
- **Size sanity:** file >1 MB. Zero-byte or KB-range = likely corrupted pg_dump
- **Naming:** matches `postgres/YYYYMMDD-HHMMSS.pgdump` (see scripts/backup/backup-pg.sh)
- **History depth:** at least 7 daily + 4 weekly snapshots present (per retention policy)

### B. Intelligence-db backup

Same checks against `s3://${BACKUP_S3_BUCKET}/intelligence/`.

This is the embeddings DB — losing it means hours of LLM re-computation on recovery. Treat staleness as seriously as the main DB.

### C. Object Storage replication

```bash
aws s3 ls s3://${BACKUP_S3_BUCKET}/storage/ \
  --endpoint-url=${BACKUP_S3_ENDPOINT} \
  --summarize | tail -5
```

Validate:

- **Freshness:** read the per-cycle heartbeat, not the newest object's age. Because `backup-storage-sync.sh` uses additive `rclone copy`, a cycle with no source changes uploads nothing, so a quiet bucket can show an old newest-object even when every sync succeeded. Check the marker instead (about 2x the configured cadence, so 12h or less at the default 6h):
  ```bash
  aws s3 ls s3://${BACKUP_S3_BUCKET}/storage/.last-sync \
    --endpoint-url=${BACKUP_S3_ENDPOINT}
  ```
  A missing or stale `.last-sync` means the sync stream is not completing; investigate its logs.
- **Object-count parity:** backup count should be 99% of source or more. Count both sides the same way, over S3, so the numbers are comparable.

  Each side passes its own credentials inline, so the source side cannot pick
  up the off-site export set above, and neither can fall back to an ambient
  profile (see Step 4):

  ```bash
  # source (MinIO on the app host, or the provider's object storage)
  AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY}" \
  AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY}" \
    aws s3 ls "s3://${S3_BUCKET}/" --recursive --summarize \
      --endpoint-url="${S3_ENDPOINT}" | tail -2

  # off-site copy
  AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY}" \
  AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY}" \
    aws s3 ls "s3://${BACKUP_S3_BUCKET}/storage/" --recursive --summarize \
      --endpoint-url="${BACKUP_S3_ENDPOINT}" | tail -2
  ```

  If the two counts are identical to the object, be suspicious rather than
  satisfied: the most common cause is both commands having hit the same bucket
  because one side's credentials or endpoint did not take effect.

  Compare "Total Objects". Report the two counts and the ratio, never just a
  verdict - a parity check whose numbers are not shown cannot be sanity-checked
  by the reader.

## Output format

Produce a structured ASCII report. Example:

```
BugSpotter Backup Health Check — 2026-05-22 14:32 +05
═══════════════════════════════════════════════════════

POSTGRES (main)
  Status:    ✓ OK
  Latest:    postgres/20260522-140000.pgdump  (32 min ago, 142 MB)
  History:   7 daily + 4 weekly snapshots
  Bucket:    <BACKUP_S3_BUCKET> @ <BACKUP_S3_ENDPOINT>

INTELLIGENCE-DB
  Status:    ✓ OK
  Latest:    intelligence/20260522-140000.pgdump  (32 min ago, 8 MB)
  Embeddings rows: 1,243

OBJECT STORAGE
  Status:    ⚠ STALE
  Last sync: 26h ago  (expected 12h or less)
  Source:    <S3_BUCKET>  (4,892 objects, 12.4 GB)
  Backup:    <BACKUP_S3_BUCKET>/storage  (4,591 objects, 11.8 GB)
  Delta:     301 missing objects, 600 MB

═══════════════════════════════════════════════════════
Verdict: ⚠ ATTENTION — Object Storage sync stale (others OK)
Action:  SSH prod →
         docker compose --profile backup logs --tail=200 storage-sync
         Check for rclone errors (auth, network, quota)
═══════════════════════════════════════════════════════
```

If everything is fine, end with:

```
Verdict: ✓ ALL OK — backups fresh, restoration-ready
Last restore-test: docs/BACKUP_VERIFICATION_2026-04-15.md (37 days ago)
```

If the last restore test is >90 days old, recommend running `bs-restore-test`.

## Escalation criteria

Thresholds below assume the default 6h cadence. If the deployment raised `BACKUP_INTERVAL_SECONDS`, scale the overdue boundary with it (about 2x the configured interval, matching the freshness window above) so a longer valid schedule is not both fresh and overdue.

| Symptom                                                       | Action                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| Any backup older than 2x the cadence (24h+ at the default 6h) | Immediate - investigate same day                         |
| PG dump <10% of usual size                                    | Possible corruption — block any migration until verified |
| Cannot list bucket at all                                     | Credentials or network — escalate to founder             |
| Backup count regression vs yesterday                          | Lifecycle policy misbehaving — review bucket rules       |
| Object Storage delta >5% of source                            | Sync broken — check rclone logs                          |

## What this skill does NOT do

- Does NOT restore anything (use `bs-restore-test`)
- Does NOT modify backup configuration
- Does NOT SSH to prod automatically — surfaces commands for human-in-loop execution
- Does NOT alert anyone — just reports status

## References

- Migration strategy: `migration-strategy.html` Phase 1 (backup setup) and Phase 4 (drill)
- Architecture context: `multi-cloud-architecture.html`
- Compose backup profile: `docker-compose.yml` (services with `profiles: [backup]`)
- Related skills: [[bs-restore-test]], [[bs-migration-precheck]], [[bs-migration-drill]], [[bs-migration-inventory]]
