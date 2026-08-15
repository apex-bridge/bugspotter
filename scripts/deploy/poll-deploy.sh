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
# runs in its own subshell specifically so a `set -e` abort inside it can't
# take down the rest of the script (see the bash/dash function+`set -e`
# gotcha: wrapping a *function call* in `|| true` does not reliably suspend
# `-e` for commands *inside* the function across shells; wrapping it in a
# subshell does, portably).

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

  short=$(printf '%s' "$new_digest" | cut -c1-19)
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
  for _ in $(seq 1 15); do
    all_healthy=1
    for c in $health_containers; do
      status=$(docker inspect --format '{{.State.Health.Status}}' "$c" 2>/dev/null || echo unknown)
      [ "$status" = healthy ] || all_healthy=0
    done
    if [ "$all_healthy" -eq 1 ]; then
      ok=1
      break
    fi
    sleep 10
  done

  if [ "$ok" -ne 1 ]; then
    echo "$(date -Iseconds) [$name] deployed $new_digest but did not report all containers healthy, not recording as deployed" >>"$LOG_FILE"
    return 1
  fi

  printf '%s' "$new_digest" >"$state_file"
  echo "$(date -Iseconds) [$name] deployed $new_digest" >>"$LOG_FILE"
}

# State-file name for `api` is unprefixed for backward compatibility with the
# digest already recorded on the host from before `admin` coverage existed -
# renaming it would just cost one harmless redundant redeploy cycle, but
# there's no reason to force that.
(deploy_one api "api:main" "api worker" "bugspotter-api bugspotter-worker" "$SCRIPT_DIR/.last-deployed-digest") ||
  echo "$(date -Iseconds) [api] deploy_one exited non-zero, continuing to admin" >>"$LOG_FILE"

(deploy_one admin "admin:main" "admin" "bugspotter-admin" "$SCRIPT_DIR/.last-deployed-digest-admin") ||
  echo "$(date -Iseconds) [admin] deploy_one exited non-zero" >>"$LOG_FILE"

exit 0
