#!/usr/bin/env bash
# Dump the intelligence-db (pgvector, embeddings) and upload it to the off-site
# backup bucket under intelligence/. Losing this DB means hours of LLM
# re-computation on recovery, so it is backed up on the same schedule as main.
#
# Skips cleanly (exit 0) when INTELLIGENCE_ENABLED is not true, so the backup
# service is safe to run on deployments without the AI stack.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/backup/lib.sh
. "${SCRIPT_DIR}/lib.sh"

if [ "${INTELLIGENCE_ENABLED:-false}" != "true" ]; then
  log "INTELLIGENCE_ENABLED is not true - skipping intelligence-db backup"
  exit 0
fi

# Build the connection string from the intelligence-db vars (mirrors compose).
: "${INTELLIGENCE_DB_HOST:=intelligence-db}"
: "${INTELLIGENCE_DB_PORT:=5432}"
: "${INTELLIGENCE_DB_NAME:=bugspotter_intelligence}"
: "${INTELLIGENCE_DB_USER:=postgres}"
require_env INTELLIGENCE_DB_PASSWORD
export_backup_creds

intel_url="postgresql://${INTELLIGENCE_DB_USER}:${INTELLIGENCE_DB_PASSWORD}@${INTELLIGENCE_DB_HOST}:${INTELLIGENCE_DB_PORT}/${INTELLIGENCE_DB_NAME}"

stamp="$(backup_stamp)"
key="intelligence/${stamp}.pgdump"
tmp="$(mktemp -t intel-XXXXXX.pgdump)"
trap 'rm -f "$tmp"' EXIT

log "dumping intelligence-db -> $key"
pg_dump "${intel_url}" -Fc --no-owner --no-acl -f "$tmp"

upload_verified "$tmp" "$key"
log "intelligence-db backup complete: $key"
