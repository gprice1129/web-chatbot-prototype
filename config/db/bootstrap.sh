#!/bin/bash
set -euo pipefail

# bootstrap.sh
#
# Runs as the superuser during first-time container initialization.
# Creates the application role, database, and applies all migrations.

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
    CREATE ROLE ${APP_DB_USER} WITH LOGIN PASSWORD '${APP_DB_PASSWORD}';
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
