# syntax=docker/dockerfile:1
#
# MinIO server + mc client, built from upstream source at pinned release tags.
#
# Why this exists: upstream no longer publishes these images publicly.
# Docker Hub minio/minio and minio/mc are gone, quay.io/minio/minio requires
# login, and the signed binaries the upstream release Dockerfile downloads from
# dl.min.io return 410 Gone. CI, the Admin E2E/integration tests and the
# docker-compose dev profile pull this image instead:
#
#   ghcr.io/apex-bridge/bugspotter/minio:<MINIO_RELEASE>-r<IMAGE_REVISION>
#
# Published by .github/workflows/minio-image.yml. Dev/test use only.
#
# Mirrors upstream Dockerfile.release at MINIO_RELEASE: same entrypoint script
# (`server /data` becomes `minio server /data`), same env defaults, both
# binaries in /usr/bin, plus curl for the compose healthcheck. The runtime
# base is Alpine instead of UBI micro.
#
# MinIO and mc are AGPL-3.0. The binaries are unmodified upstream source at the
# commits below; LICENSE/CREDITS are copied to /licenses and the source
# location is recorded in the image labels.

# The published tag is <MINIO_RELEASE>-r<IMAGE_REVISION>. Bump the four
# versions together and reset IMAGE_REVISION to 1; bump only IMAGE_REVISION
# when the image changes without a version change (published tags are never
# overwritten). Then update the tag in ci.yml, docker-compose*.yml, DOCKER.md,
# the two testcontainers call sites and storage.integration.test.ts.
# r1 was the bare <MINIO_RELEASE> tag, whose --version strings were wrong.
ARG IMAGE_REVISION=2
ARG MINIO_RELEASE=RELEASE.2024-10-13T13-34-11Z
ARG MINIO_COMMIT=d10bb7e1b667c2df72c394ef1fa52ab4a6802d0f
ARG MC_RELEASE=RELEASE.2024-10-08T09-37-26Z
ARG MC_COMMIT=cf128de2cf42e763e7bd30c6df8b749fa94e0c10
# go.mod of both tags declares go 1.22; upstream built with golang:1.22-alpine.
ARG GO_VERSION=1.22

FROM --platform=$BUILDPLATFORM golang:${GO_VERSION}-alpine AS build
ARG MINIO_RELEASE MINIO_COMMIT MC_RELEASE MC_COMMIT TARGETOS TARGETARCH
RUN apk add --no-cache git
ENV CGO_ENABLED=0

# Fetch exactly one tag and refuse to build if it no longer points at the
# pinned commit (tags can be moved or recreated upstream).
RUN set -eu; \
    fetch() { \
      git init -q "/src/$1"; \
      git -C "/src/$1" fetch -q --depth 1 "https://github.com/minio/$1" "refs/tags/$2"; \
      git -C "/src/$1" checkout -q FETCH_HEAD; \
      got=$(git -C "/src/$1" rev-parse HEAD); \
      [ "$got" = "$3" ] || { echo "minio/$1 tag $2 is $got, expected $3" >&2; exit 1; }; \
    }; \
    fetch minio "$MINIO_RELEASE" "$MINIO_COMMIT"; \
    fetch mc "$MC_RELEASE" "$MC_COMMIT"

# Same flags as upstream `make build`. gen-ldflags.go turns an RFC3339 time
# into "<prefix>.<time>", taking the prefix from $MINIO_RELEASE / $MC_RELEASE
# (upstream's release builds set them to "RELEASE"). Those names collide with
# our build args, which RUN sees as env vars, so override them to "RELEASE" for
# `go run` only - otherwise the version reads RELEASE.<time>.<time>.
# `go run` runs on the build platform; only `go build` cross-compiles.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    set -eu; \
    rfc3339() { echo "$1" | sed -E 's/^RELEASE\.([0-9-]+)T([0-9]+)-([0-9]+)-([0-9]+)Z$/\1T\2:\3:\4Z/'; }; \
    mkdir -p /out; \
    cd /src/minio; \
    ld=$(MINIO_RELEASE=RELEASE go run buildscripts/gen-ldflags.go "$(rfc3339 "$MINIO_RELEASE")"); \
    GOOS=$TARGETOS GOARCH=$TARGETARCH go build -tags kqueue -trimpath -ldflags "$ld" -o /out/minio; \
    cd /src/mc; \
    ld=$(MC_RELEASE=RELEASE go run buildscripts/gen-ldflags.go "$(rfc3339 "$MC_RELEASE")"); \
    GOOS=$TARGETOS GOARCH=$TARGETARCH go build -tags kqueue -trimpath -ldflags "$ld" -o /out/mc

FROM alpine:3.20
ARG MINIO_RELEASE MINIO_COMMIT MC_RELEASE MC_COMMIT

RUN apk add --no-cache ca-certificates curl

COPY --from=build /out/minio /out/mc /usr/bin/
COPY --from=build --chmod=0755 /src/minio/dockerscripts/docker-entrypoint.sh /usr/bin/docker-entrypoint.sh
COPY --from=build /src/minio/LICENSE /src/minio/CREDITS /licenses/minio/
COPY --from=build /src/mc/LICENSE /src/mc/CREDITS /licenses/mc/

# Same defaults as upstream Dockerfile.release.
ENV MINIO_ACCESS_KEY_FILE=access_key \
    MINIO_SECRET_KEY_FILE=secret_key \
    MINIO_ROOT_USER_FILE=access_key \
    MINIO_ROOT_PASSWORD_FILE=secret_key \
    MINIO_KMS_SECRET_KEY_FILE=kms_master_key \
    MINIO_CONFIG_ENV_FILE=config.env \
    MC_CONFIG_DIR=/tmp/.mc

LABEL org.opencontainers.image.source="https://github.com/apex-bridge/bugspotter" \
      org.opencontainers.image.description="MinIO ${MINIO_RELEASE} + mc ${MC_RELEASE}, built from upstream source for BugSpotter dev/test" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.version="${MINIO_RELEASE}" \
      io.bugspotter.minio.source="https://github.com/minio/minio/tree/${MINIO_COMMIT}" \
      io.bugspotter.mc.source="https://github.com/minio/mc/tree/${MC_COMMIT}" \
      io.bugspotter.mc.version="${MC_RELEASE}"

EXPOSE 9000
VOLUME ["/data"]

ENTRYPOINT ["/usr/bin/docker-entrypoint.sh"]
CMD ["minio"]
