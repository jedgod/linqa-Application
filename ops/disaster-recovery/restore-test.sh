#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"
: "${BACKUP_FILE:?BACKUP_FILE is required}"

echo "Starting isolated restore test."

created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --dbname="$RESTORE_DATABASE_URL" \
  "$BACKUP_FILE"

psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT count(*) AS users_count FROM users;
SELECT count(*) AS devices_count FROM devices;
SELECT count(*) AS envelope_count FROM message_envelopes;
SELECT count(*) AS migration_table_check
FROM information_schema.tables
WHERE table_schema = 'public';
SQL

echo "Restore test completed at ${created_at}."
