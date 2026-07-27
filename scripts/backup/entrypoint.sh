#!/usr/bin/env bash
# Backup service loop. Runs one cycle immediately on start (so a fresh deploy has
# a backup within minutes, not hours), then every BACKUP_INTERVAL_SECONDS.
#
# A cycle: dump main Postgres, dump intelligence-db (if enabled), copy object
# storage, then prune old dumps per the retention policy. A failure in one stream
# is logged and does not abort the others or the loop - a broken storage sync
# must not stop Postgres backups.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

INTERVAL="${BACKUP_INTERVAL_SECONDS:-21600}"       # cadence between cycles; default 6h
RETRY_INTERVAL="${BACKUP_RETRY_SECONDS:-600}"      # shorter wait after a failed cycle; default 10m
STREAM_TIMEOUT="${BACKUP_STREAM_TIMEOUT_SECONDS:-14400}" # per-stream wall-clock cap; 0 disables. default 4h

# Bound each stream with GNU `timeout` (coreutils, in the image) so a hung
# pg_dump/aws/rclone can't stall the whole cycle and starve later streams. A
# stream that fails or times out is logged and does not abort the cycle.
run() {
  local name="$1" script="$2" rc=0
  log "=== ${name} ==="
  if [ "${STREAM_TIMEOUT}" -gt 0 ]; then
    timeout "${STREAM_TIMEOUT}" "${SCRIPT_DIR}/${script}" || rc=$?
  else
    "${SCRIPT_DIR}/${script}" || rc=$?
  fi
  if [ "$rc" -eq 0 ]; then
    log "=== ${name} OK ==="
  elif [ "$rc" -eq 124 ]; then
    log "=== ${name} TIMED OUT after ${STREAM_TIMEOUT}s (continuing) ==="
    return 1
  else
    log "=== ${name} FAILED (rc=${rc}, continuing) ==="
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

# Reject non-positive / non-numeric timing values up front: passed straight to
# `sleep`, a bad INTERVAL would fail and spin the loop, hammering the sources.
require_positive_int() {
  local name="$1" value="$2"
  [[ "$value" =~ ^[1-9][0-9]*$ ]] || die "${name} must be a positive integer, got '${value}'"
}
require_positive_int BACKUP_INTERVAL_SECONDS "$INTERVAL"
require_positive_int BACKUP_RETRY_SECONDS "$RETRY_INTERVAL"
[[ "$STREAM_TIMEOUT" =~ ^[0-9]+$ ]] \
  || die "BACKUP_STREAM_TIMEOUT_SECONDS must be a non-negative integer (0 disables), got '${STREAM_TIMEOUT}'"

log "backup service starting (interval=${INTERVAL}s, retry=${RETRY_INTERVAL}s, stream_timeout=${STREAM_TIMEOUT}s)"
while true; do
  if cycle; then
    log "sleeping ${INTERVAL}s until next cycle"
    sleep "${INTERVAL}"
  else
    log "cycle had failures; retrying in ${RETRY_INTERVAL}s"
    sleep "${RETRY_INTERVAL}"
  fi
done
