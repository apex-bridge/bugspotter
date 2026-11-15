#!/bin/sh
# Smoke test for the MinIO + mc image, exercising it the way the repo uses it.
#
#   docker/minio/smoke-test.sh <image> [platform]
#
# platform defaults to linux/amd64; linux/arm64 needs QEMU on an amd64 host.
# Expected versions and commits are read from the Dockerfile next to this
# script. Run by .github/workflows/minio-image.yml against the local build and
# against the published tag.
set -eu

IMAGE=${1:?usage: smoke-test.sh <image> [platform]}
PLATFORM=${2:-linux/amd64}
DOCKERFILE="$(dirname "$0")/Dockerfile"

arg() { sed -n "s/^ARG $1=//p" "$DOCKERFILE"; }
MINIO_RELEASE=$(arg MINIO_RELEASE)
MINIO_COMMIT=$(arg MINIO_COMMIT)
MC_RELEASE=$(arg MC_RELEASE)
MC_COMMIT=$(arg MC_COMMIT)

run() { docker run --rm --platform "$PLATFORM" "$@"; }

echo "== $IMAGE ($PLATFORM)"

# A registry image may be cached locally for another platform (a tag holds one
# platform at a time locally), so pull the one under test explicitly.
case "$IMAGE" in
  */*) docker pull -q --platform "$PLATFORM" "$IMAGE" >/dev/null ;;
esac

# First line must equal the official binaries' exactly, e.g.
# "minio version RELEASE.2024-10-13T13-34-11Z (commit-id=d10bb7e...)".
check_version() {
  got=$(run --entrypoint "$1" "$IMAGE" --version | head -n1)
  want="$1 version $2 (commit-id=$3)"
  echo "$got"
  if [ "$got" != "$want" ]; then
    echo "::error::$1 --version on $PLATFORM is '$got', expected '$want'"
    exit 1
  fi
}
check_version minio "$MINIO_RELEASE" "$MINIO_COMMIT"
check_version mc "$MC_RELEASE" "$MC_COMMIT"

# The entrypoint's MINIO_USERNAME path needs GNU chroot (busybox lacks --userspec).
run --entrypoint chroot "$IMAGE" --userspec=0:0 / true

# Started the way the tests and compose start it: the command has no leading
# `minio`, the entrypoint adds it.
name="minio-smoke-$$"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$name" --platform "$PLATFORM" \
  -e MINIO_ROOT_USER=smoke-admin -e MINIO_ROOT_PASSWORD=smoke-secret-key \
  "$IMAGE" server /data --console-address ':9001' >/dev/null

ok=
for _ in $(seq 1 60); do
  # Same probe as the docker-compose healthcheck.
  if docker exec "$name" curl -sf http://127.0.0.1:9000/minio/health/live; then ok=1; break; fi
  sleep 1
done
if [ -z "$ok" ]; then docker logs "$name"; exit 1; fi

# Same mc calls as the tests, plus the admin API used by scripts/init-minio.sh.
docker exec "$name" sh -c \
  'mc alias set local http://localhost:9000 smoke-admin smoke-secret-key && mc mb local/smoke --ignore-existing && mc admin info local'

echo "== OK: $IMAGE ($PLATFORM)"
