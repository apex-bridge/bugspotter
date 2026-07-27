#!/usr/bin/env bash
# Unit tests for the retention decision logic (select_deletions) in prune.sh.
# Pure function, no S3 - generates synthetic keys and asserts the keep/delete
# partition and its invariants. Run: bash scripts/backup/test-prune.sh
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/backup/prune.sh
. "${SCRIPT_DIR}/prune.sh"
# prune.sh sets `set -euo pipefail`; relax it for the test harness so a single
# assertion failure doesn't silently abort the whole run.
set +eu

pass=0
fail=0
ok()   { pass=$((pass + 1)); }
bad()  { fail=$((fail + 1)); printf 'FAIL: %s\n' "$1" >&2; }

# Generate keys every 6h for N days back from a fixed anchor, newest first.
# Anchor is fixed so the test is deterministic regardless of "now".
gen_keys() {
  local days="$1" prefix="${2:-postgres}"
  local anchor="2026-07-27 18:00:00"
  local total=$(( days * 4 )) i
  for (( i = 0; i < total; i++ )); do
    date -u -d "${anchor} $(( i * 6 )) hours ago" +"${prefix}/%Y%m%d-%H%M%S.pgdump"
  done
}

# ---- Test 1: fewer keys than keep_recent -> zero deletions ----
BACKUP_KEEP_RECENT=8 BACKUP_KEEP_DAILY=7 BACKUP_KEEP_WEEKLY=4
out="$(gen_keys 1 | select_deletions)"   # 4 keys, all within keep_recent
if [ -z "$out" ]; then ok; else bad "1: expected no deletions for 4 keys, got: $out"; fi

# ---- Test 2: newest keep_recent are never deleted ----
keys="$(gen_keys 40)"
dels="$(printf '%s\n' "$keys" | select_deletions)"
newest8="$(printf '%s\n' "$keys" | sort -r | head -8)"
clash=0
while IFS= read -r k; do
  [ -n "$k" ] || continue
  printf '%s\n' "$dels" | grep -qxF "$k" && clash=1
done <<< "$newest8"
if [ "$clash" -eq 0 ]; then ok; else bad "2: a newest-8 key was scheduled for deletion"; fi

# ---- Test 3: keep/delete is a clean partition of the input ----
kept="$(comm -23 <(printf '%s\n' "$keys" | sort -u) <(printf '%s\n' "$dels" | sort -u))"
n_in=$(printf '%s\n' "$keys" | sort -u | grep -c .)
n_keep=$(printf '%s\n' "$kept" | grep -c .)
n_del=$(printf '%s\n' "$dels" | sort -u | grep -c .)
if [ "$(( n_keep + n_del ))" -eq "$n_in" ]; then ok; else bad "3: partition mismatch keep=$n_keep del=$n_del in=$n_in"; fi

# ---- Test 4: over 40 days SOMETHING is pruned (retention actually bounds) ----
if [ "$n_del" -gt 0 ]; then ok; else bad "4: expected deletions over a 40-day span"; fi

# ---- Test 5: idempotence - pruning the KEPT set deletes nothing more ----
again="$(printf '%s\n' "$kept" | select_deletions)"
if [ -z "$again" ]; then ok; else bad "5: re-pruning the kept set deleted more: $again"; fi

# ---- Test 6: kept set is bounded (not everything survives) ----
# recent(8) + daily(7) + weekly(4), minus overlap, so well under the 160 inputs.
if [ "$n_keep" -le 20 ] && [ "$n_keep" -ge 8 ]; then ok; else bad "6: kept count out of expected range: $n_keep"; fi

# ---- Test 7: non-matching keys are ignored (never emitted) ----
out="$(printf 'postgres/not-a-stamp.pgdump\npostgres/latest.txt\n\n' | select_deletions)"
if [ -z "$out" ]; then ok; else bad "7: emitted a non-matching key: $out"; fi

# ---- Test 8: the single oldest key over a long span IS deleted ----
oldest="$(printf '%s\n' "$keys" | sort | head -1)"
if printf '%s\n' "$dels" | grep -qxF "$oldest"; then ok; else bad "8: oldest key was not pruned"; fi

printf '\nprune retention: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
