#!/usr/bin/env bash
set -euo pipefail

# gen_secrets.sh
#
# Scaffolds the runtime secret files consumed by docker-compose.yml's
# `secrets:` block. Each secret is a single-value file that compose mounts
# into the relevant container at /run/secrets/<name>. 
#
# Random values are generated for the DB and cookie-signing secrets.
# Anthropic/Azure API key cannot be generated -- paste your real key when
# prompted (or pre-create the file and it is left untouched).
#
# The directory defaults to ./secrets (gitignored) and can be overridden
# with SECRETS_DIR to match wherever you keep secrets on the server.
#
# Usage:
#   scripts/gen_secrets.sh
#   SECRETS_DIR=/etc/aim-hi/secrets scripts/gen_secrets.sh

SECRETS_DIR="${SECRETS_DIR:-./secrets}"
mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

write_random() {
  local name="$1"
  local mode="${2:-600}"
  local path="$SECRETS_DIR/$name"
  if [ -s "$path" ]; then
    echo "exists, leaving as-is: $path" >&2
    return
  fi
  openssl rand -base64 32 | tr -d '\n' > "$path"
  chmod "$mode" "$path"
  echo "generated: $path" >&2
}

write_random postgres_password
# 0644 (not 0600): the postgres image runs its initdb scripts (bootstrap.sh) as
# the unprivileged "postgres" user (uid 70), which must read this secret to
# create the application role. The secrets/ directory itself is 0700, so other
# host users still cannot reach the file. The other secrets are read only by
# root processes inside their containers, so they stay 0600.
write_random app_db_password 644
write_random cookie_key

api_path="$SECRETS_DIR/anthropic_api_key"
if [ -s "$api_path" ]; then
  echo "exists, leaving as-is: $api_path" >&2
else
  printf 'Paste the Anthropic/Azure API key (input hidden): ' >&2
  read -rs api_key
  echo >&2
  printf '%s' "$api_key" > "$api_path"
  chmod 600 "$api_path"
  echo "wrote: $api_path" >&2
fi

echo "Done. Secret files are in '$SECRETS_DIR' (chmod 600, gitignored)." >&2
