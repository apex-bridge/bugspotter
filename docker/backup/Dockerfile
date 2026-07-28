# Off-site KZ backup runner: dumps Postgres + intelligence-db and mirrors object
# storage to a second KZ cloud (PS.KZ). Small, single-purpose, no app code.
FROM alpine:3.20

# postgresql16-client: pg_dump (>= server major; prod main + intelligence are pg16)
# aws-cli: upload/list/prune against the S3-compatible backup bucket
# rclone: cross-endpoint object-storage mirror (Yandex -> PS.KZ)
# coreutils: GNU date (ISO week %G%V + reliable -d parsing) for retention
# bash + tzdata: scripts use bash; timestamps are UTC
RUN apk add --no-cache \
      postgresql16-client \
      aws-cli \
      rclone \
      coreutils \
      bash \
      tzdata \
  && rm -rf /var/cache/apk/*

WORKDIR /opt/backup
COPY scripts/backup/ /opt/backup/
RUN chmod +x /opt/backup/*.sh

# No secrets baked in - all credentials come from the environment at runtime.
ENTRYPOINT ["/opt/backup/entrypoint.sh"]
