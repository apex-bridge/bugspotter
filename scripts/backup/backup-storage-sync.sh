#!/usr/bin/env bash
# Mirror the source object storage (screenshots, replays, attachments) to the
# off-site backup bucket under storage/.
#
# Uses rclone because the source and destination are two DIFFERENT S3 endpoints;
# `aws s3 sync` cannot cross endpoints in one command. rclone copies only
# new/changed objects, so repeated runs are cheap.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/backup/lib.sh
. "${SCRIPT_DIR}/lib.sh"

require_env \
  S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY \
  BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY

# Two rclone remotes configured entirely from env (no config file on disk):
#   src  = source object storage (read-only use here)
#   dst  = off-site backup bucket
export RCLONE_CONFIG_SRC_TYPE=s3
export RCLONE_CONFIG_SRC_PROVIDER="${S3_PROVIDER:-Other}"
export RCLONE_CONFIG_SRC_ENDPOINT="${S3_ENDPOINT}"
export RCLONE_CONFIG_SRC_ACCESS_KEY_ID="${S3_ACCESS_KEY}"
export RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="${S3_SECRET_KEY}"
export RCLONE_CONFIG_SRC_REGION="${S3_REGION:-us-east-1}"

export RCLONE_CONFIG_DST_TYPE=s3
export RCLONE_CONFIG_DST_PROVIDER="${BACKUP_S3_PROVIDER:-Other}"
export RCLONE_CONFIG_DST_ENDPOINT="${BACKUP_S3_ENDPOINT}"
export RCLONE_CONFIG_DST_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY}"
export RCLONE_CONFIG_DST_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY}"
export RCLONE_CONFIG_DST_REGION="${BACKUP_S3_REGION:-us-east-1}"

log "syncing object storage src:${S3_BUCKET} -> dst:${BACKUP_S3_BUCKET}/storage"
# --fast-list cuts API calls on large buckets; --checksum avoids re-copying on
# clock skew between providers.
rclone copy "src:${S3_BUCKET}" "dst:${BACKUP_S3_BUCKET}/storage" \
  --fast-list --checksum --transfers "${BACKUP_SYNC_TRANSFERS:-8}" \
  --stats-one-line --stats "${BACKUP_SYNC_STATS_INTERVAL:-30s}"

log "object storage sync complete"
