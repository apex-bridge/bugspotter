---
name: bs-backup-health
description: Check whether BugSpotter production backups in the off-site KZ bucket are fresh and restorable. Reports last-backup timestamps per data source (main Postgres, intelligence-db, YC Object Storage), validates file size sanity, surfaces stale or missing backups with remediation suggestions. TRIGGER when user asks about backup status, backup health, "проверь бэкапы", DR readiness; before running a migration drill; before production migration; as a weekly health check.
---

# bs-backup-health

Verifies that BugSpotter prod data is safely backed up to a second (non-YC) KZ cloud and ready for restoration. **Does NOT modify anything** — read-only inspection.

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

From `.env.example`, `docker-compose.yml`, or `.env.sops`, extract:

- `BACKUP_S3_BUCKET` (expected: `bugspotter-backup-kz`)
- `BACKUP_S3_ENDPOINT` (PS.KZ or Pro-Data endpoint)

Report which provider is being used so the user has context.

### Step 3 — Credentials availability

- If `aws` CLI exists locally AND `BACKUP_S3_ACCESS_KEY` is set → run checks directly via Bash.
- If credentials are only on prod VM → output the commands for the user to run on prod, ask them to paste output.

**Never** print full secret keys back to the user.

### Step 4 — Source-side tooling (`yc` CLI)

The object-count parity check (below) reads the source bucket via the Yandex Cloud CLI.

- Verify it is installed and authenticated first: `yc --version` and `yc config list` (or `yc iam create-token`).
- **If `yc` is missing or unauthenticated** → skip the parity check and report it as "not verified (yc unavailable)" rather than failing; the freshness check still stands. Fallback: read object count from the YC console or the Object Storage REST API.

## Procedure

Check three backup sources in order. For each, report Status (OK / STALE / MISSING / CORRUPT), latest file, age, size.

### A. Main Postgres backup

```bash
aws s3 ls s3://${BACKUP_S3_BUCKET}/postgres/ \
  --endpoint-url=${BACKUP_S3_ENDPOINT} \
  --recursive | sort | tail -5
```

Validate:

- **Freshness:** latest file ≤12 hours old (pg-backup runs every 6h; 12h means we missed a cycle)
- **Size sanity:** file >1 MB. Zero-byte or KB-range = likely corrupted pg_dump
- **Naming:** matches `postgres/YYYYMMDD-HH.pgdump` (or current scripts/backup-pg.sh convention)
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

- **Freshness:** rclone sync runs hourly → newest object should be ≤2h old
- **Object-count parity:** backup count should be ≥99% of source. Requires `yc` (see Step 4); skip if unavailable. Get source count:
  ```bash
  yc storage bucket get bugspotter-storage-kz --format json | jq '{size_bytes, object_count}'
  ```
  Then compare.

## Output format

Produce a structured ASCII report. Example:

```
BugSpotter Backup Health Check — 2026-05-22 14:32 +05
═══════════════════════════════════════════════════════

POSTGRES (main)
  Status:    ✓ OK
  Latest:    postgres/20260522-14.pgdump  (32 min ago, 142 MB)
  History:   7 daily + 4 weekly snapshots
  Bucket:    bugspotter-backup-kz @ PS.KZ

INTELLIGENCE-DB
  Status:    ✓ OK
  Latest:    intelligence/20260522-14.pgdump  (32 min ago, 8 MB)
  Embeddings rows: 1,243

OBJECT STORAGE
  Status:    ⚠ STALE
  Last sync: 26h ago  (expected ≤2h)
  Source:    bugspotter-storage-kz  (4,892 objects, 12.4 GB)
  Backup:    bugspotter-backup-kz/storage  (4,591 objects, 11.8 GB)
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

| Symptom                              | Action                                                   |
| ------------------------------------ | -------------------------------------------------------- |
| Any backup >24h old                  | Immediate — investigate same day                         |
| PG dump <10% of usual size           | Possible corruption — block any migration until verified |
| Cannot list bucket at all            | Credentials or network — escalate to founder             |
| Backup count regression vs yesterday | Lifecycle policy misbehaving — review bucket rules       |
| Object Storage delta >5% of source   | Sync broken — check rclone logs                          |

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
