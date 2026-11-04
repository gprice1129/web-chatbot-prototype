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
#   scripts/inject_user.sh <username> <email>
#
# The password is never taken as an argument, so it stays out of shell
# history and `ps`. On a terminal it is asked for twice with input
# hidden. Otherwise it is read as one line from stdin, which lets the
# installer and other scripts pipe it in:
#
#   scripts/inject_user.sh alice alice@example.com
#   printf '%s\n' "$PASSWORD" | scripts/inject_user.sh alice alice@example.com
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
  echo "usage: $0 <username> <email>   (password is prompted for, or read from stdin)" >&2
  exit 2
}

[ "$#" -eq 2 ] || usage
USERNAME="$1"
EMAIL="$2"
[ -n "$USERNAME" ] && [ -n "$EMAIL" ] || usage

# Ask for the password twice with echo off, and insist the two match.
prompt_password() {
  local first second
  printf 'Password for %s: ' "$USERNAME" >&2
  IFS= read -rs first
  echo >&2
  printf 'Repeat password: ' >&2
  IFS= read -rs second
  echo >&2
  if [ "$first" != "$second" ]; then
    echo "error: passwords do not match." >&2
    exit 1
  fi
  PASSWORD="$first"
}

# Take the password from a prompt on a terminal, else one line of stdin.
if [ -t 0 ]; then
  prompt_password
else
  IFS= read -r PASSWORD || true
fi
if [ -z "$PASSWORD" ]; then
  echo "error: empty password." >&2
  exit 1
fi

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

# The script the postgres container runs. It reads the three values as
# lines from stdin and hands them to psql through the environment, so
# none of them is in any argv, on the host or in the container, where
# every local user could read it from /proc. psql's :'...' then emits them
# as quoted SQL literals, so quotes or '$' in any input cannot break out
# into SQL. APP_DB_USER and APP_DB_NAME come from the container's own
# environment.
INJECT_SCRIPT="$(cat <<'EOF'
set -e
IFS= read -r INJECT_USERNAME
IFS= read -r INJECT_EMAIL
IFS= read -r INJECT_PHASH
export INJECT_USERNAME INJECT_EMAIL INJECT_PHASH
psql -v ON_ERROR_STOP=1 --username "$APP_DB_USER" --dbname "$APP_DB_NAME" <<'SQL'
\getenv username INJECT_USERNAME
\getenv email INJECT_EMAIL
\getenv phash INJECT_PHASH
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
EOF
)"

# Inject the user. Only the static script above is on the command line.
echo "Injecting user '$USERNAME'..." >&2
printf '%s\n%s\n%s\n' "$USERNAME" "$EMAIL" "$PASSWORD_HASH" \
  | docker compose exec -T postgres sh -c "$INJECT_SCRIPT"

echo "Done." >&2
