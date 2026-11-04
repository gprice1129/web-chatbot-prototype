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
# prompted (or pre-create the file and its value is left untouched).
#
# The directory is 0700 and is what keeps other users on the host out. The
# files are 0644: compose bind-mounts each one with its host owner and mode,
# and the containers read them as unprivileged users (node in the app,
# postgres in the database), who could not open a root-owned 0600 file. An
# existing file keeps its value but is given that mode.
#
# The directory defaults to ./secrets (gitignored) and can be overridden
# with SECRETS_DIR to match wherever you keep secrets on the server.
#
# Usage:
#   scripts/gen_secrets.sh
#   SECRETS_DIR=/etc/aim-hi/secrets scripts/gen_secrets.sh

SECRETS_DIR="${SECRETS_DIR:-./secrets}"
FILE_MODE=644
mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

# A random value, unless the file already has one. Either way it gets the mode.
write_random() {
  local name="$1"
  local path="$SECRETS_DIR/$name"
  if [ -s "$path" ]; then
    chmod "$FILE_MODE" "$path"
    echo "exists, keeping its value: $path" >&2
    return
  fi
  openssl rand -base64 32 | tr -d '\n' > "$path"
  chmod "$FILE_MODE" "$path"
  echo "generated: $path" >&2
}

write_random postgres_password
write_random app_db_password
write_random cookie_key

api_path="$SECRETS_DIR/anthropic_api_key"
if [ -s "$api_path" ]; then
  chmod "$FILE_MODE" "$api_path"
  echo "exists, keeping its value: $api_path" >&2
else
  printf 'Paste the Anthropic/Azure API key (input hidden): ' >&2
  read -rs api_key
  echo >&2
  printf '%s' "$api_key" > "$api_path"
  chmod "$FILE_MODE" "$api_path"
  echo "wrote: $api_path" >&2
fi

echo "Done. Secret files are in '$SECRETS_DIR' (directory 0700, files 0644, gitignored)." >&2
