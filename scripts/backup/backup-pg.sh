#!/usr/bin/env bash
# Dump the main Postgres database (Yandex Managed PostgreSQL in prod) and upload
# the dump to the off-site KZ backup bucket under postgres/.
#
# Reads DATABASE_URL (same connection string the app uses). pg_dump connects over
# the network; this does not touch or lock the source beyond a normal dump.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/backup/lib.sh
. "${SCRIPT_DIR}/lib.sh"

require_env DATABASE_URL
export_backup_creds

stamp="$(backup_stamp)"
key="postgres/${stamp}.pgdump"
tmp="$(mktemp -t pg-XXXXXX.pgdump)"
trap 'rm -f "$tmp"' EXIT

log "dumping main Postgres -> $key"
# -Fc: custom format (compressed, selective restore). --no-owner/--no-acl keep the
# dump portable across roles when restoring into a fresh managed instance.
pg_dump "${DATABASE_URL}" -Fc --no-owner --no-acl -f "$tmp"

upload_verified "$tmp" "$key"
log "main Postgres backup complete: $key"
