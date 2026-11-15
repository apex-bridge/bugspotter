# syntax=docker/dockerfile:1
#
# MinIO server + mc client, built from upstream source at pinned release tags.
#
# Why this exists: upstream no longer publishes these images publicly.
# Docker Hub minio/minio and minio/mc are gone, quay.io/minio/minio requires
# login, and the signed binaries the upstream release Dockerfile downloads from
# dl.min.io return 410 Gone. Everything that used minio/minio or minio/mc pulls
# this image instead:
#
#   ghcr.io/apex-bridge/bugspotter/minio:<MINIO_RELEASE>-r<IMAGE_REVISION>
#
# Consumers: CI, the backend integration and Admin E2E testcontainers, the
# `minio` / `minio-init` services of the compose dev profile, and
# docker-compose.storage.yml, which serves the same `minio` service as the
# public HTTPS storage endpoint for self-hosted "MinIO-on-the-box". The last one
# is production use: this is the same MinIO release that was pinned before
# (2024-10, Go 1.22 toolchain) and receives no upstream fixes; moving to a newer
# release is a separate decision.
#
# Published by .github/workflows/minio-image.yml; smoke-test.sh next to this
# file is run against the local build and against the published tag on both
# platforms.
#
# Mirrors upstream Dockerfile.release at MINIO_RELEASE: same entrypoint script
# (`server /data` becomes `minio server /data`), same env defaults, both
# binaries in /usr/bin, plus curl for the compose healthcheck. The runtime
# base is Alpine instead of UBI micro; coreutils is added because the
# entrypoint's MINIO_USERNAME/MINIO_GROUPNAME path uses `chroot --userspec`,
# which busybox chroot does not support.
#
# MinIO and mc are AGPL-3.0. The binaries are unmodified upstream source at the
# commits below; LICENSE/CREDITS are copied to /licenses and the source
# location is recorded in the image labels.

# The published tag is <MINIO_RELEASE>-r<IMAGE_REVISION>. Bump the four
# versions together and reset IMAGE_REVISION to 1; bump only IMAGE_REVISION
# when a non-comment line of this Dockerfile changes without a version change.
# Published tags are never overwritten: minio-image.yml fails if the tag exists
# but was built from a different Dockerfile (comment and blank lines are not
# hashed, and smoke-test.sh is not part of the image, so editing either needs
# no bump).
#
# Every reference to the tag must match; `node scripts/check-minio-image-tag.mjs`
# (run in CI) lists the ones that do not. On a bump, ci.yml's
# `minio-image-ready` job waits until minio-image.yml has published the new tag
# before the integration and Admin E2E jobs start.
#
# History: r1 was the bare <MINIO_RELEASE> tag (doubled --version strings);
# r2 fixed those; r3 added coreutils and a context-hash label over all of
# docker/minio/; r4 hashes only the Dockerfile's non-comment lines.
ARG IMAGE_REVISION=4
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
# sha256 of this Dockerfile without comment/blank lines, passed by
# minio-image.yml; lets the workflow tell whether a published tag was built
# from the current Dockerfile.
ARG CONTEXT_SHA256=unset

RUN apk add --no-cache ca-certificates curl coreutils

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
      org.opencontainers.image.description="MinIO ${MINIO_RELEASE} + mc ${MC_RELEASE}, built from upstream source for BugSpotter" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.version="${MINIO_RELEASE}" \
      io.bugspotter.minio.source="https://github.com/minio/minio/tree/${MINIO_COMMIT}" \
      io.bugspotter.mc.source="https://github.com/minio/mc/tree/${MC_COMMIT}" \
      io.bugspotter.mc.version="${MC_RELEASE}" \
      io.bugspotter.context.sha256="${CONTEXT_SHA256}"

EXPOSE 9000
VOLUME ["/data"]

ENTRYPOINT ["/usr/bin/docker-entrypoint.sh"]
CMD ["minio"]
