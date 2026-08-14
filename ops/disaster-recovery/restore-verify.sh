#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"

dump="$(mktemp "${TMPDIR:-/tmp}/linqa-restore-verify.XXXXXX.dump")"
trap 'rm -f "$dump"' EXIT

pg_dump "$DATABASE_URL" --format=custom --file="$dump"
RESTORE_DATABASE_URL="$RESTORE_DATABASE_URL" \
BACKUP_FILE="$dump" \
DATABASE_URL="$DATABASE_URL" \
  "$(dirname "$0")/restore-test.sh"

psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT count(*) AS transparency_events FROM key_transparency_events;
SELECT count(*) AS backup_manifests FROM backup_manifests;
SELECT count(*) AS relay_envelopes FROM message_envelopes;
SQL

echo "Restore verification completed."