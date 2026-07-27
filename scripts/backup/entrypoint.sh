#!/usr/bin/env bash
# Backup service loop. Runs one cycle immediately on start (so a fresh deploy has
# a backup within minutes, not hours), then every BACKUP_INTERVAL_SECONDS.
#
# A cycle: dump main Postgres, dump intelligence-db (if enabled), mirror object
# storage, then prune old dumps per the retention policy. A failure in one stream
# is logged and does not abort the others or the loop - a broken storage sync
# must not stop Postgres backups.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

INTERVAL="${BACKUP_INTERVAL_SECONDS:-21600}" # default 6h

run() {
  local name="$1" script="$2"
  log "=== ${name} ==="
  if "${SCRIPT_DIR}/${script}"; then
    log "=== ${name} OK ==="
  else
    log "=== ${name} FAILED (continuing) ==="
    return 1
  fi
}

# lib.sh for log(); sourced after defining nothing that conflicts.
# shellcheck source=scripts/backup/lib.sh
. "${SCRIPT_DIR}/lib.sh"

cycle() {
  local rc=0
  run "main Postgres backup" backup-pg.sh || rc=1
  run "intelligence-db backup" backup-intelligence.sh || rc=1
  run "object storage sync" backup-storage-sync.sh || rc=1
  run "retention prune" prune.sh || rc=1
  if [ "$rc" -eq 0 ]; then
    log "cycle complete: all streams OK"
  else
    log "cycle complete: one or more streams FAILED (see above)"
  fi
  return "$rc"
}

log "backup service starting (interval=${INTERVAL}s)"
while true; do
  cycle || true
  log "sleeping ${INTERVAL}s until next cycle"
  sleep "${INTERVAL}"
done
