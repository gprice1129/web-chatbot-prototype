#!/usr/bin/env bash
set -euo pipefail

# inject_user.sh
#
# Creates (or, on re-run, password-resets) a local-credential user
# directly in the running Postgres container, bypassing the normal
# sign-up flow. There is no sign-up route, so this is how the first
# login on a fresh install is made.
#
# Everything runs inside the compose stack, so the host needs only
# Docker. The password is hashed with argon2id by the app container,
# using the same `argon2` dependency AuthService uses (see
# packages/aim_hi_webserver/src/lib/auth.ts), so authenticate_user()
# accepts the result. The row is then written by `psql` inside the
# postgres container, which already carries APP_DB_USER / APP_DB_NAME
# in its environment (see docker-compose.yml).
#
# Usage:
#   scripts/inject_user.sh <username> <email> <password>
#
# Example:
#   scripts/inject_user.sh alice alice@example.com 's3cret!'
#
# The stack must be up (`docker compose up -d` or the aim-hi service).
#
# Notes:
#   * Re-running with an existing username updates that user's email,
#     password, and marks email_verified -- i.e. it doubles as a
#     password reset.
#   * Uniqueness is enforced case-insensitively on both username and
#     email. If the email already belongs to a *different* user, psql
#     reports a unique-violation and the script exits non-zero.

usage() {
  echo "usage: $0 <username> <email> <password>" >&2
  exit 2
}

[ "$#" -eq 3 ] || usage
USERNAME="$1"
EMAIL="$2"
PASSWORD="$3"
[ -n "$USERNAME" ] && [ -n "$EMAIL" ] && [ -n "$PASSWORD" ] || usage

# Compose resolves docker-compose.yml and .env from the project root.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# Fail early with a clear message if the stack isn't up.
if ! docker compose exec -T app true 2>/dev/null; then
  echo "error: the app container is not running." >&2
  echo "       start the stack with 'docker compose up -d' first." >&2
  exit 1
fi

# Hash the password with argon2id (argon2's default) in the app container.
# The password travels over stdin so it never appears in any argv.
echo "Hashing password with argon2id..." >&2
PASSWORD_HASH="$(
  printf '%s' "$PASSWORD" | docker compose exec -T app node -e '
    const argon2 = require("argon2");
    let password = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { password += chunk; });
    process.stdin.on("end", () => {
      argon2.hash(password)
        .then((h) => process.stdout.write(h))
        .catch((err) => { console.error(err); process.exit(1); });
    });
  '
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
echo "Injecting user '$USERNAME'..." >&2
docker compose exec -T postgres sh -s "$USERNAME" "$EMAIL" "$PASSWORD_HASH" <<'OUTER'
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
