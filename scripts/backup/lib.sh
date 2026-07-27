#!/usr/bin/env bash
# Shared helpers for the off-site KZ backup scripts.
#
# All backup streams (main Postgres, intelligence-db, object storage) land in a
# SECOND KZ cloud (PS.KZ), never Yandex, so a Yandex account-level failure cannot
# take the backups with it. Nothing here writes to the source; it only reads the
# source and writes to the backup bucket.
set -euo pipefail

log() { printf '%s [backup] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

# Fail fast if a required env var is unset/empty. Never echoes the value.
require_env() {
  local name
  for name in "$@"; do
    if [ -z "${!name:-}" ]; then
      die "required env var $name is not set"
    fi
  done
}

# aws s3/s3api against the off-site backup bucket. Credentials come from
# BACKUP_S3_ACCESS_KEY / BACKUP_S3_SECRET_KEY (exported as AWS_* by the caller).
aws_backup() {
  aws --endpoint-url "${BACKUP_S3_ENDPOINT}" "$@"
}

# Upload a local file to s3://<bucket>/<key>, then verify the remote object's
# size matches the local file. A silently-truncated upload is worse than a loud
# failure, so we treat a size mismatch as an error.
upload_verified() {
  local local_path="$1" key="$2"
  local size
  size="$(wc -c < "$local_path" | tr -d ' ')"
  [ "$size" -gt 0 ] || die "refusing to upload empty file $local_path (key=$key)"

  log "uploading $key (${size} bytes)"
  aws_backup s3 cp "$local_path" "s3://${BACKUP_S3_BUCKET}/${key}" >/dev/null

  local remote_size
  remote_size="$(aws_backup s3api head-object \
    --bucket "${BACKUP_S3_BUCKET}" --key "${key}" \
    --query 'ContentLength' --output text 2>/dev/null || echo "")"
  [ "$remote_size" = "$size" ] \
    || die "upload size mismatch for $key: local=$size remote=${remote_size:-missing}"
  log "uploaded + verified $key"
}

# UTC timestamp used in object keys: YYYYMMDD-HHMMSS, lexically sortable so the
# health-check's `aws s3 ls ... | sort | tail` picks the newest correctly.
backup_stamp() { date -u +'%Y%m%d-%H%M%S'; }

# Export AWS_* from the BACKUP_S3_* vars so the aws CLI authenticates against the
# backup bucket without a shared profile. Called once per script.
export_backup_creds() {
  require_env BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY
  export AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY}"
  export AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY}"
  export AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-kz-1}"
}
