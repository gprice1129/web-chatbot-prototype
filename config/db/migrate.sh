#!/bin/bash
set -euo pipefail

# migrate.sh
#
# Applies pending SQL migrations to the application database. Runs on every
# deploy as a one-shot service.
#
# Idempotent: it consults schema_migrations and applies only versions that are
# not yet recorded there, each inside its own transaction. Connection settings
# come from the standard libpq environment variables (PGHOST, PGUSER,
# PGDATABASE, ...).

# Support the Docker secret "*_FILE" convention for the connection password.
if [ -z "${PGPASSWORD:-}" ] && [ -n "${PGPASSWORD_FILE:-}" ]; then
    PGPASSWORD="$(cat "$PGPASSWORD_FILE")"
    export PGPASSWORD
fi

run() { psql -v ON_ERROR_STOP=1 --no-psqlrc "$@"; }

# Ensure the tracking table exists before we query it. 000 is idempotent.
echo "Ensuring migration tracking table exists"
run -q -f /migrations/000_create_migrations_table.sql

# Versions already applied to this database (newline-separated).
applied="$(run -tAc 'SELECT version FROM schema_migrations')"

for f in /migrations/*.sql; do
    basename=$(basename "$f")

    version="${basename%%[!0-9]*}"          # strip everything after leading digits
    version=$(echo "$version" | sed 's/^0*//')  # strip leading zeros
    version="${version:-0}"                 # default to 0 if all zeros

    if grep -qx "$version" <<<"$applied"; then
        echo "Skipping already-applied migration: $basename"
        continue
    fi

    echo "Applying migration: $basename"
    run -f "$f"

    checksum=$(sha256sum "$f")
    checksum="${checksum%% *}"
    run -c "UPDATE schema_migrations SET checksum = '${checksum}' WHERE version = ${version};"
done

# Re-apply idempotent seed data. Seed files must be safe to run repeatedly
# (ON CONFLICT DO NOTHING / WHERE NOT EXISTS).
for f in /seed/*.sql; do
    [ -e "$f" ] || continue
    echo "Applying seed: $(basename "$f")"
    run -f "$f"
done

echo "Migrations complete."
