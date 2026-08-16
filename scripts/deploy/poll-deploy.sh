#!/bin/sh
set -eu

# Polls ghcr.io for newer `api` and `admin` images and redeploys each
# independently when its digest changes. Runs on the production host via
# cron every 3 minutes (deploy user's crontab, not this repo - see README.md
# in this directory). No inbound network dependency: the host pulls, nothing
# pushes to it.
#
# `api` and `admin` are deployed independently - a failure or a no-op on one
# must never block the other, since they ship on different cadences and one
# CI failure shouldn't stall an unrelated fix. Each `deploy_one` call below
# runs in its own subshell so a `set -e` abort inside it can't take down the
# rest of the script.
#
# IMPORTANT: `(deploy_one ...) || fallback` does NOT do this safely, even
# though it looks like it should. Per POSIX (and verified empirically against
# both bash and dash): a compound command that is the non-final member of an
# AND-OR list executes with -e *ignored for its entire dynamic extent* -
# including an explicit `set -e` restated as the first line inside the
# subshell. Concretely, `(deploy_one) || echo fallback` lets a failing
# `docker compose up` inside `deploy_one` fall straight through to the health
# check and (if stale containers still read healthy) get recorded as a
# successful deploy. The fix used below: disable -e out here first, run the
# subshell as a bare statement (never the left side of `&&`/`||`) so its own
# `set -e` actually takes effect, capture $?, then restore -e before
# branching on the result.

REGISTRY_BASE="ghcr.io/apex-bridge/bugspotter"
SCRIPT_DIR="/opt/bugspotter/scripts"
LOCK_FILE="$SCRIPT_DIR/.poll-deploy.lock"
LOG_FILE="$SCRIPT_DIR/.poll-deploy.log"

exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

# $1 = name (used for image tag prefix + log lines, e.g. "api" or "admin")
# $2 = image, without registry prefix (e.g. "api:main")
# $3 = `docker compose up -d --no-build` service list for this deploy (e.g. "api worker")
# $4 = container names to health-check before recording success (e.g. "bugspotter-api bugspotter-worker")
# $5 = state file tracking the last digest deployed for this name
deploy_one() {
  name="$1"
  image="$REGISTRY_BASE/$2"
  services="$3"
  health_containers="$4"
  state_file="$5"

  pull_output=$(docker pull "$image")
  new_digest=$(printf '%s\n' "$pull_output" | awk '/^Digest: sha256:/{print $2}')
  if [ -z "$new_digest" ]; then
    echo "$(date -Iseconds) [$name] could not parse a digest from docker pull output, skipping" >>"$LOG_FILE"
    return 1
  fi

  old_digest=$(cat "$state_file" 2>/dev/null || true)
  [ "$new_digest" = "$old_digest" ] && return 0

  echo "$(date -Iseconds) [$name] deploying $new_digest (was: ${old_digest:-none})" >>"$LOG_FILE"

  # Strip the "sha256:" prefix before truncating - a Docker tag can't contain
  # a second colon, and the untruncated digest always has one right after
  # the algorithm name. The original single-image script truncated the raw
  # digest (`cut -c1-12`) and silently produced an invalid tag every run;
  # confirmed by actually running this rewrite against production rather
  # than trusting the read - `docker tag` failed with "invalid reference
  # format" and the rollback tag was never created, though the deploy itself
  # still completed since that failure wasn't the last command in its list.
  short=$(printf '%s' "${new_digest#sha256:}" | cut -c1-12)
  new_id=$(docker image inspect --format '{{.Id}}' "$image")
  old_id=$(docker image inspect --format '{{.Id}}' "bugspotter-$name:latest" 2>/dev/null || true)
  if [ -n "$old_id" ] && [ "$new_id" != "$old_id" ]; then
    docker tag "bugspotter-$name:latest" "bugspotter-$name:pre-$short"
  fi
  docker tag "$image" "bugspotter-$name:latest"
  cd /opt/bugspotter
  # shellcheck disable=SC2086 # $services is a deliberately unquoted word list
  docker compose up -d --no-build $services

  ok=0
  last_statuses=""
  for _ in $(seq 1 15); do
    all_healthy=1
    last_statuses=""
    for c in $health_containers; do
      status=$(docker inspect --format '{{.State.Health.Status}}' "$c" 2>/dev/null || echo unknown)
      last_statuses="$last_statuses $c=$status"
      [ "$status" = healthy ] || all_healthy=0
    done
    if [ "$all_healthy" -eq 1 ]; then
      ok=1
      break
    fi
    sleep 10
  done

  if [ "$ok" -ne 1 ]; then
    echo "$(date -Iseconds) [$name] deployed $new_digest but did not report all containers healthy (${last_statuses# }), not recording as deployed" >>"$LOG_FILE"
    return 1
  fi

  # Write the state file atomically - a temp file + rename means a process
  # kill mid-write can never leave a truncated digest for the next run to
  # read (the lock file already keeps runs from overlapping, but this is
  # free insurance against a partial write on its own).
  tmp_state_file="$state_file.tmp"
  printf '%s' "$new_digest" >"$tmp_state_file"
  mv "$tmp_state_file" "$state_file"
  echo "$(date -Iseconds) [$name] deployed $new_digest" >>"$LOG_FILE"
}

# State-file name for `api` is unprefixed for backward compatibility with the
# digest already recorded on the host from before `admin` coverage existed -
# renaming it would just cost one harmless redundant redeploy cycle, but
# there's no reason to force that.
set +e
(set -e; deploy_one api "api:main" "api worker" "bugspotter-api bugspotter-worker" "$SCRIPT_DIR/.last-deployed-digest")
api_status=$?
set -e
if [ "$api_status" -ne 0 ]; then
  echo "$(date -Iseconds) [api] deploy_one exited non-zero, continuing to admin" >>"$LOG_FILE"
fi

set +e
(set -e; deploy_one admin "admin:main" "admin" "bugspotter-admin" "$SCRIPT_DIR/.last-deployed-digest-admin")
admin_status=$?
set -e
if [ "$admin_status" -ne 0 ]; then
  echo "$(date -Iseconds) [admin] deploy_one exited non-zero" >>"$LOG_FILE"
fi

exit 0
