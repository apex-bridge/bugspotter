# Off-site Backups

BugSpotter's primary data (Postgres, intelligence-db embeddings, object storage)
lives in one place. Whatever the primary provider is, its own platform snapshots
live in the same account - a billing lock, an account action, or an operator
mistake can take the primary data and its snapshots together. This backup runner
copies the data to a separate, **off-site S3-compatible bucket** so a failure in
the primary provider's account cannot destroy every copy.

It is **hosting-agnostic**: point `BACKUP_S3_*` at any S3-compatible target (AWS
S3, MinIO, Backblaze B2, Wasabi, a second cloud). It is **opt-in**
(`profiles: [backup]`) and **inert** until you provision the bucket and set the
credentials. The runner is **read-only on every source** - it only writes to the
backup bucket.

## What it backs up

| Stream          | Source                                 | Destination key               | Cadence          |
| --------------- | -------------------------------------- | ----------------------------- | ---------------- |
| Main Postgres   | `DATABASE_URL`                         | `postgres/<stamp>.pgdump`     | every cycle (6h) |
| intelligence-db | `intelligence-db` container (pgvector) | `intelligence/<stamp>.pgdump` | every cycle (6h) |
| Object storage  | `S3_*`                                 | `storage/...`                 | every cycle (6h) |

`<stamp>` is `YYYYMMDD-HHMMSS` (UTC, lexically sortable). Intelligence-db is
skipped unless `INTELLIGENCE_ENABLED=true`.

## Retention (grandfather-father-son)

Applied to `postgres/` and `intelligence/` after each cycle
(`scripts/backup/prune.sh`). Object storage is a live mirror, not pruned by age.

- keep the newest `BACKUP_KEEP_RECENT` dumps outright (default 8 = ~48h at 6h)
- keep the newest dump per calendar day for `BACKUP_KEEP_DAILY` days (default 7)
- keep the newest dump per ISO week for `BACKUP_KEEP_WEEKLY` weeks (default 4)
- delete everything else

## One-time setup (owner)

1. **Provision the off-site bucket** on any S3-compatible provider. Prefer a
   provider or region **distinct from the primary** (that separation is the whole
   point). Create the bucket and a service access key **scoped to that bucket
   only**. If a data-residency rule applies to your deployment, choose a bucket
   region that satisfies it.
2. **Set the credentials** on the prod host `.env` (never commit them):
   ```dotenv
   COMPOSE_PROFILES=...,backup            # add backup to the active profiles
   BACKUP_S3_ENDPOINT=https://s3.example.com
   BACKUP_S3_BUCKET=bugspotter-backups
   BACKUP_S3_ACCESS_KEY=<key>
   BACKUP_S3_SECRET_KEY=<secret>
   BACKUP_S3_REGION=us-east-1
   ```
   The main-PG (`DATABASE_URL`) and object-storage (`S3_*`) values are already in
   the prod env; the runner reuses them read-only.
3. **Start the runner:**
   ```bash
   docker compose --profile backup up -d pg-backup
   docker compose logs -f pg-backup      # watch the first cycle
   ```
   It runs one cycle immediately, then every `BACKUP_INTERVAL_SECONDS`.

## Verify

- `bs-backup-health` skill - freshness/size/parity report against the bucket.
- Manual freshness check:
  ```bash
  aws s3 ls s3://$BACKUP_S3_BUCKET/postgres/ --endpoint-url $BACKUP_S3_ENDPOINT \
    --recursive | sort | tail -5
  ```

## Restore drill

Do this after the first backup and on a schedule (a backup you have not restored
is not a backup). Restore into a **throwaway** database, never over prod.

```bash
# 1. Pick the newest dump
key=$(aws s3 ls s3://$BACKUP_S3_BUCKET/postgres/ --endpoint-url $BACKUP_S3_ENDPOINT \
  | awk '{print $NF}' | sort | tail -1)

# 2. Download it
aws s3 cp "s3://$BACKUP_S3_BUCKET/postgres/$key" /tmp/restore.pgdump \
  --endpoint-url $BACKUP_S3_ENDPOINT

# 3. Restore into a fresh scratch DB (NOT prod)
createdb -h <host> -U <user> restore_drill
pg_restore --no-owner --no-acl -d "postgresql://<user>:<pw>@<host>:6432/restore_drill" \
  /tmp/restore.pgdump

# 4. Sanity-check row counts, then drop it
psql -h <host> -U <user> -d restore_drill -c '\dt'
dropdb -h <host> -U <user> restore_drill
```

This exact round-trip (dump -> upload -> download -> `pg_restore` -> row-count
check) was verified manually against a throwaway pg16 + MinIO pair during
development. The committed automated test covers the retention logic
(`scripts/backup/test-prune.sh`); the dump/restore round-trip is a manual drill.

## Failure handling

A failure in one stream is logged and does **not** stop the others or the loop -
a broken object-storage sync must never block Postgres dumps. Investigate with
`docker compose logs pg-backup`; escalation criteria are in the `bs-backup-health`
skill.

## Tests

- `bash scripts/backup/test-prune.sh` - retention decision logic (pure function,
  8 invariants incl. partition + idempotence). Also runs inside the image.
