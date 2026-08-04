#!/bin/bash
set -euo pipefail

# bootstrap.sh
#
# Runs as the superuser during first-time container initialization (only when
# the data volume is first created). Creates the application role and database.
#
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

# Extensions the migrations depend on. CREATE EXTENSION requires superuser --
# which the app role deliberately is not -- so it cannot live in a numbered
# migration. This covers fresh volumes; databases that predate an extension get
# it from the superuser pre-step in migrate.sh.
#
#   * vector (pgvector) -- backs the embeddings table in migration 012.
#     Requires the postgres image to ship pgvector (see docker-compose.yml).
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$APP_DB_NAME" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS vector;
EOSQL
