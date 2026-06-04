#!/usr/bin/env bash
set -euo pipefail

# inject_user.sh
#
# Creates (or, on re-run, password-resets) a local-credential user
# directly in the running Postgres container, bypassing the normal
# sign-up flow. Handy for seeding a login during development.
#
# The password is hashed with argon2id on the host using the project's
# own `argon2` dependency, so the resulting PHC string matches what
# AuthService produces (see packages/aim_hi_webserver/src/lib/auth.ts)
# and authenticate_user() will accept it. The row is then written by
# execing `psql` inside the DB container.
#
# The container already carries APP_DB_USER / APP_DB_NAME in its
# environment (see docker-compose.yml), so the script resolves the role
# and database from inside the container -- no host-side env file needed.
#
# Usage:
#   scripts/inject_user.sh <username> <email> <password>
#
# Example:
#   scripts/inject_user.sh alice alice@example.com 's3cret!'
#
# Environment overrides:
#   DB_CONTAINER   name of the postgres container (default: postgres)
#
# Notes:
#   * Re-running with an existing username updates that user's email,
#     password, and marks email_verified -- i.e. it doubles as a
#     dev-time password reset.
#   * Uniqueness is enforced case-insensitively on both username and
#     email. If the email already belongs to a *different* user, psql
#     reports a unique-violation and the script exits non-zero.

DB_CONTAINER="${DB_CONTAINER:-postgres}"

usage() {
  echo "usage: $0 <username> <email> <password>" >&2
  exit 2
}

[ "$#" -eq 3 ] || usage
USERNAME="$1"
EMAIL="$2"
PASSWORD="$3"

[ -n "$USERNAME" ] && [ -n "$EMAIL" ] && [ -n "$PASSWORD" ] || usage

# Resolve the project root (parent of this script's dir) so node picks up
# the workspace's node_modules/argon2 regardless of where we're invoked.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

# Fail early with a clear message if the container isn't up.
if ! docker exec "$DB_CONTAINER" true 2>/dev/null; then
  echo "error: DB container '$DB_CONTAINER' is not running." >&2
  echo "       start it with 'docker compose up' or set DB_CONTAINER." >&2
  exit 1
fi

# Hash the password with argon2id (argon2's default) on the host. The
# password is passed as a process argument so it never lands in argv of
# any shell-interpolated string.
echo "Hashing password with argon2id..." >&2
PASSWORD_HASH="$(
  cd "$ROOT_DIR" && node -e '
    const argon2 = require("argon2");
    argon2.hash(process.argv[1])
      .then((h) => process.stdout.write(h))
      .catch((err) => { console.error(err); process.exit(1); });
  ' "$PASSWORD"
)"

if [ -z "$PASSWORD_HASH" ]; then
  echo "error: failed to produce a password hash." >&2
  exit 1
fi

# Inject the user. Values cross into the container as positional args to
# `sh` ($1/$2/$3) and are handed to psql as variables, which :'...' then
# emits as safely-quoted SQL string literals -- so quotes or '$' in any
# input can't break out into SQL. APP_DB_USER / APP_DB_NAME expand from
# the container's own environment. The SQL is fed to psql over stdin.
echo "Injecting user '$USERNAME' into '$DB_CONTAINER'..." >&2
docker exec -i "$DB_CONTAINER" sh -s "$USERNAME" "$EMAIL" "$PASSWORD_HASH" <<'OUTER'
set -e
psql -v ON_ERROR_STOP=1 \
     --username "$APP_DB_USER" \
     --dbname "$APP_DB_NAME" \
     --set=username="$1" \
     --set=email="$2" \
     --set=phash="$3" <<'SQL'
INSERT INTO users (username, email, email_verified, password_hash)
VALUES (:'username', :'email', true, :'phash')
ON CONFLICT (lower(username)) DO UPDATE
   SET email          = EXCLUDED.email,
       password_hash  = EXCLUDED.password_hash,
       email_verified = true;

SELECT id, username, email, email_verified, created_at
FROM users
WHERE lower(username) = lower(:'username');
SQL
OUTER

echo "Done." >&2
