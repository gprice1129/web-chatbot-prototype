#!/bin/bash
set -euo pipefail

# bootstrap.sh
#
# Runs as the superuser during first-time container initialization.
# Creates the application role, database, and applies all migrations.

# Support the Docker secret "*_FILE" convention: if APP_DB_PASSWORD is not set
# directly but APP_DB_PASSWORD_FILE points at a file, load the value from it.
# (The superuser POSTGRES_PASSWORD is handled natively by the postgres image.)
if [ -z "${APP_DB_PASSWORD:-}" ] && [ -n "${APP_DB_PASSWORD_FILE:-}" ]; then
    APP_DB_PASSWORD="$(cat "$APP_DB_PASSWORD_FILE")"
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    --set=app_pw="$APP_DB_PASSWORD" <<-EOSQL
    CREATE ROLE ${APP_DB_USER} WITH LOGIN PASSWORD :'app_pw';
    CREATE DATABASE ${APP_DB_NAME} OWNER ${APP_DB_USER};
EOSQL

for f in /migrations/*.sql; do
    basename=$(basename "$f")
    echo "Applying migration: $basename"
    psql -v ON_ERROR_STOP=1 --username "$APP_DB_USER" --dbname "$APP_DB_NAME" -f "$f"

    version="${basename%%[!0-9]*}"   # strip everything after leading digits
    version=$(echo "$version" | sed 's/^0*//' )  # strip leading zeros
    version="${version:-0}"          # default to 0 if all zeros
    checksum=$(sha256sum "$f")
    checksum="${checksum%% *}"
    psql -v ON_ERROR_STOP=1 --username "$APP_DB_USER" --dbname "$APP_DB_NAME" \
        -c "UPDATE schema_migrations SET checksum = '${checksum}' WHERE version = ${version};"
done
