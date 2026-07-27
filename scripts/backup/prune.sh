#!/usr/bin/env bash
# Grandfather-father-son retention for the timestamped dump streams
# (postgres/, intelligence/). Pure decision logic lives in select_deletions so it
# can be unit-tested without S3; main() applies it against the backup bucket.
#
# Retention (all configurable):
#   - keep the newest BACKUP_KEEP_RECENT dumps outright (intra-day granularity)
#   - keep the newest dump per calendar day for BACKUP_KEEP_DAILY days
#   - keep the newest dump per ISO week for BACKUP_KEEP_WEEKLY weeks
#   - delete everything else
#
# Object storage (storage/) is NOT pruned here - it is an additive copy that
# deliberately retains objects even after they are deleted at the source (see
# backup-storage-sync.sh), so age-based pruning would defeat its purpose. Bound
# its growth with a lifecycle policy on the backup bucket if needed.
set -euo pipefail

# Parse the YYYYMMDD-HHMMSS stamp out of a key like "postgres/20260727-120000.pgdump".
# Echoes "<epoch> <YYYYMMDD> <ISOyearweek> <key>" or nothing if it doesn't match.
_parse_key() {
  local key="$1" base stamp y m d H M S
  base="${key##*/}"
  stamp="${base%.pgdump}"
  [[ "$stamp" =~ ^([0-9]{4})([0-9]{2})([0-9]{2})-([0-9]{2})([0-9]{2})([0-9]{2})$ ]] || return 0
  y="${BASH_REMATCH[1]}"; m="${BASH_REMATCH[2]}"; d="${BASH_REMATCH[3]}"
  H="${BASH_REMATCH[4]}"; M="${BASH_REMATCH[5]}"; S="${BASH_REMATCH[6]}"
  local epoch week
  epoch="$(date -u -d "${y}-${m}-${d} ${H}:${M}:${S}" +%s 2>/dev/null)" || return 0
  week="$(date -u -d "${y}-${m}-${d}" +%G%V 2>/dev/null)" || return 0
  printf '%s %s %s %s\n' "$epoch" "${y}${m}${d}" "$week" "$key"
}

# Reads keys on stdin (one per line), prints the keys to DELETE on stdout.
# Deterministic and side-effect-free.
select_deletions() {
  local keep_recent="${BACKUP_KEEP_RECENT:-8}"
  local keep_daily="${BACKUP_KEEP_DAILY:-7}"
  local keep_weekly="${BACKUP_KEEP_WEEKLY:-4}"

  # Reject malformed retention counts before making any delete decision: a
  # non-numeric or negative value would silently disable a tier and over-delete.
  local value
  for value in "$keep_recent" "$keep_daily" "$keep_weekly"; do
    if ! [[ "$value" =~ ^[0-9]+$ ]]; then
      log "invalid retention count: '${value}' (want a non-negative integer)"
      return 2
    fi
  done

  local parsed
  parsed="$(while IFS= read -r k; do [ -n "$k" ] && _parse_key "$k"; done | sort -rn)"
  [ -n "$parsed" ] || return 0

  declare -A keep=() seen_day=() seen_week=()
  local n=0 epoch day week key
  while read -r epoch day week key; do
    [ -n "$key" ] || continue
    n=$((n + 1))
    # newest N outright
    if [ "$n" -le "$keep_recent" ]; then keep["$key"]=1; fi
    # newest per day, for the most recent keep_daily distinct days
    if [ -z "${seen_day[$day]:-}" ]; then
      if [ "${#seen_day[@]}" -lt "$keep_daily" ]; then keep["$key"]=1; fi
      seen_day["$day"]=1
    fi
    # newest per ISO week, for the most recent keep_weekly distinct weeks
    if [ -z "${seen_week[$week]:-}" ]; then
      if [ "${#seen_week[@]}" -lt "$keep_weekly" ]; then keep["$key"]=1; fi
      seen_week["$week"]=1
    fi
  done <<< "$parsed"

  # Emit deletions in chronological order (oldest first).
  while read -r epoch day week key; do
    [ -n "$key" ] || continue
    [ -z "${keep[$key]:-}" ] && printf '%s\n' "$key"
  done <<< "$(printf '%s\n' "$parsed" | sort -n)"
}

_prune_prefix() {
  local prefix="$1" keys deletions
  # No `|| true`: a failed listing (bad creds/endpoint/network) must fail this
  # stream, not masquerade as "nothing to delete" and silently skip retention.
  # `set -o pipefail` propagates an aws failure through the awk pipe. An empty
  # prefix legitimately lists nothing and exits 0, so it stays a no-op.
  keys="$(aws_backup s3 ls "s3://${BACKUP_S3_BUCKET}/${prefix}/" --recursive \
    | awk '{print $NF}')"
  deletions="$(printf '%s\n' "$keys" | select_deletions)"
  if [ -z "$deletions" ]; then
    log "prune ${prefix}: nothing to delete"
    return 0
  fi
  local key
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    log "prune ${prefix}: deleting $key"
    aws_backup s3 rm "s3://${BACKUP_S3_BUCKET}/${key}" >/dev/null
  done <<< "$deletions"
}

# Only run main() when executed directly, so tests can source the functions.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck source=scripts/backup/lib.sh
  . "${SCRIPT_DIR}/lib.sh"
  export_backup_creds
  _prune_prefix postgres
  _prune_prefix intelligence
fi
