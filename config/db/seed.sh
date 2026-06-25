#!/bin/bash
set -euo pipefail

# seed.sh
#
# Applies seed SQL files from /seed/ after migrations have run. Seed
# files must be idempotent -- re-running the seed against an
# already-seeded database is a no-op (use ON CONFLICT DO NOTHING or
# WHERE NOT EXISTS).
#
# Seeds are applied automatically on every deploy by config/db/migrate.sh
# (the `migrate` service), after migrations. This standalone script can also
# be invoked manually against a running database with APP_DB_USER and
# APP_DB_NAME set.

for f in /seed/*.sql; do
    [ -e "$f" ] || continue
    echo "Applying seed: $(basename "$f")"
    psql -v ON_ERROR_STOP=1 --username "$APP_DB_USER" --dbname "$APP_DB_NAME" -f "$f"
done
