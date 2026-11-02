#!/usr/bin/env bash
set -euo pipefail

# install.sh
#
# Installs the stack on a server as a systemd service built from this
# source tree. Run it as root from an unpacked bundle (see scripts/bundle.sh)
# or a checkout with submodules. It assumes Docker with the compose plugin
# and systemd are present, and that a TLS reverse proxy on the host will
# front the gateway, which listens only on 127.0.0.1:8080.
#
# What it does, in order:
#   1. writes config/docker/override.json with this site's values
#   2. generates the secret files under /etc/aim-hi/secrets
#   3. renders .env from the production profile and refuses mock auth
#   4. pulls and builds the images
#   5. installs and starts the aim-hi systemd service
#   6. creates the first login
#
# Every answer is asked for on a terminal, and may be given up front as an
# environment variable, which is also how a non-interactive install works:
#
#   AIM_HI_SERVER_NAME         public hostname, e.g. chat.example.org
#   AIM_HI_BASE_PATH           URL prefix the app is served under (default /)
#   AIM_HI_ANTHROPIC_BASE_URL  model endpoint (default https://api.anthropic.com)
#   AIM_HI_ANTHROPIC_API_KEY   the key for that endpoint
#   AIM_HI_ADMIN_USER          first login's username (blank skips the login)
#   AIM_HI_ADMIN_EMAIL         first login's email
#   AIM_HI_ADMIN_PASSWORD      first login's password
#
# Re-running is safe: existing override.json and secrets are kept, .env is
# re-rendered, images are rebuilt, and the service is restarted. That is
# also how an update from a newer bundle is applied.
#
# A stack started by hand from another directory is a different compose
# project with its own volumes. When one is found, the script offers to stop
# it and copy its database and uploads into this install, and reuses its
# secret files so the copied database still opens. The old volumes are left
# in place as a fallback.
#
#   AIM_HI_MIGRATE             y to accept that offer without a terminal
#
# Two more variables exist for unusual layouts and for testing:
#   AIM_HI_SECRETS_DIR  where secrets live (default /etc/aim-hi/secrets)
#   AIM_HI_UNIT_DIR     where the unit goes (default /etc/systemd/system)

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

SERVICE="aim-hi"
PROFILE="production"
OVERRIDE="$ROOT_DIR/config/docker/override.json"
ENV_FILE="$ROOT_DIR/.env"
UNIT_TEMPLATE="$ROOT_DIR/config/systemd/$SERVICE.service"
SECRETS_DIR="${AIM_HI_SECRETS_DIR:-/etc/aim-hi/secrets}"
UNIT_DIR="${AIM_HI_UNIT_DIR:-/etc/systemd/system}"
# The node image the Dockerfile builds with, reused to render .env when the
# host has no Node of its own.
NODE_IMAGE="node:24-bookworm-slim"

log() { echo "==> $*" >&2; }
die() { echo "error: $*" >&2; exit 1; }

# Whether answers can be asked for interactively.
interactive() { [ -t 0 ]; }

# Put the value of AIM_HI_<name> into <name>, asking on a terminal when it
# is unset. A blank answer takes the default. With no terminal and no
# default, the variable is required.
ask() {
  local name="$1" prompt="$2" default="${3-}"
  local env_name="AIM_HI_$name" value
  value="${!env_name-}"
  if [ -z "$value" ] && interactive; then
    if [ -n "$default" ]; then
      printf '%s [%s]: ' "$prompt" "$default" >&2
    else
      printf '%s: ' "$prompt" >&2
    fi
    read -r value
  fi
  if [ -z "$value" ]; then value="$default"; fi
  if [ -z "$value" ]; then die "$env_name is required when not run from a terminal"; fi
  printf -v "$name" '%s' "$value"
}

# Like ask, but with input hidden and the answer typed twice.
ask_secret() {
  local name="$1" prompt="$2"
  local env_name="AIM_HI_$name" first second
  first="${!env_name-}"
  if [ -z "$first" ] && interactive; then
    printf '%s: ' "$prompt" >&2
    read -rs first
    echo >&2
    printf 'Repeat %s: ' "$prompt" >&2
    read -rs second
    echo >&2
    if [ "$first" != "$second" ]; then die "the two entries do not match"; fi
  fi
  if [ -z "$first" ]; then die "$env_name is required when not run from a terminal"; fi
  printf -v "$name" '%s' "$first"
}

# A yes/no question, answered from the environment or the terminal.
confirm() {
  local name="$1" prompt="$2" default="$3"
  local answer
  ask "$name" "$prompt" "$default"
  answer="${!name}"
  case "$answer" in
    [Yy]*) return 0 ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# 0. Preflight
# ---------------------------------------------------------------------------

# The tools and the tree this script relies on.
preflight() {
  if [ "$(id -u)" -ne 0 ]; then die "run as root (sudo scripts/install.sh)"; fi
  command -v docker >/dev/null || die "docker is not installed"
  docker compose version >/dev/null 2>&1 || die "the docker compose plugin is not installed"
  command -v systemctl >/dev/null || die "systemd is not available"
  [ -f "$ROOT_DIR/docker-compose.yml" ] || die "no docker-compose.yml in $ROOT_DIR"
  [ -f "$ROOT_DIR/packages/aim_hi_fe/package.json" ] || die "the frontend submodule is missing"
  [ -d "$ROOT_DIR/packages/static/knowledge" ] || die "the static submodule is missing"
  [ -f "$UNIT_TEMPLATE" ] || die "no unit template at $UNIT_TEMPLATE"
  find_old_stack
  check_port
}

# ---------------------------------------------------------------------------
# An earlier stack on this host
# ---------------------------------------------------------------------------

# The compose project started from some other directory, if there is one.
OLD_PROJECT=""
OLD_DIR=""
OLD_STATE=""
OLD_SECRETS_DIR=""
MIGRATE=n

# The project name compose gives this directory: the basename, lowercased,
# with anything but letters, digits, '_' and '-' dropped.
project_name() {
  basename "$ROOT_DIR" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]//g'
}

# Whether a project owns both data volumes this stack uses. That is what
# tells one of our stacks apart from any other compose project with a
# service called postgres.
has_our_volumes() {
  docker volume inspect "$1_postgres_data" "$1_uploads" >/dev/null 2>&1
}

# Look for a postgres container of ours whose project was started from a
# directory other than this one, and offer to take its data over.
find_old_stack() {
  local rows row project dir state name
  rows="$(docker ps -a --filter label=com.docker.compose.service=postgres \
    --format '{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.working_dir"}}\t{{.State}}\t{{.Names}}')"
  while IFS=$'\t' read -r project dir state name; do
    [ -n "$project" ] || continue
    [ "$dir" != "$ROOT_DIR" ] || continue
    has_our_volumes "$project" || continue
    if [ -n "$OLD_PROJECT" ]; then
      die "more than one earlier stack on this host ($OLD_PROJECT, $project); remove the ones you do not want first"
    fi
    OLD_PROJECT="$project"; OLD_DIR="$dir"; OLD_STATE="$state"
    OLD_SECRETS_DIR="$(old_secrets_dir "$name")"
  done <<< "$rows"
  [ -n "$OLD_PROJECT" ] || return 0
  offer_migration
}

# The directory the old postgres container reads its secret files from.
old_secrets_dir() {
  local source
  source="$(docker inspect "$1" --format \
    '{{range .Mounts}}{{if eq .Destination "/run/secrets/postgres_password"}}{{.Source}}{{end}}{{end}}')"
  [ -n "$source" ] || return 0
  dirname "$source"
}

# Ask whether the old stack's data should be moved here. Declining is fine
# while the old stack is stopped; a running one would fight over the port.
offer_migration() {
  cat >&2 <<EOF

An earlier stack is on this host ($OLD_STATE):
  project:   $OLD_PROJECT
  started from: $OLD_DIR
  secrets:   ${OLD_SECRETS_DIR:-unknown}
This install is a new project ($(project_name)) with empty volumes. Migrating
stops the old stack, copies its database and uploads into this install, and
reuses its secret files. The old volumes are kept as a fallback.
EOF
  if confirm MIGRATE "Migrate the old stack's data into this install? (y/n)" "n"; then
    MIGRATE=y
    return
  fi
  MIGRATE=n
  if [ "running" = "$OLD_STATE" ]; then
    die "the old stack is running; stop it with 'docker compose -p $OLD_PROJECT down' or set AIM_HI_MIGRATE=y"
  fi
  log "leaving the old stack's data where it is; this install starts empty"
  OLD_PROJECT=""
}

# Refuse when something outside this project already holds the gateway port.
check_port() {
  local holder
  holder="$(docker ps --filter publish=8080 \
    --format '{{.Label "com.docker.compose.project.working_dir"}}\t{{.Names}}' \
    | awk -F'\t' -v here="$ROOT_DIR" '$1 != here { print $2 }')"
  [ -n "$holder" ] || return 0
  if [ -n "$OLD_PROJECT" ] && [ "$MIGRATE" = y ]; then return 0; fi
  die "port 8080 is held by container '$holder', which is not part of this install"
}

# Bring the old secret files over so the copied database still opens. A
# file that is already here must be identical, or the two would disagree.
inherit_secrets() {
  [ -n "$OLD_PROJECT" ] && [ -n "$OLD_SECRETS_DIR" ] || return 0
  [ "$OLD_SECRETS_DIR" != "$SECRETS_DIR" ] || return 0
  local name from to
  for name in postgres_password app_db_password cookie_key anthropic_api_key; do
    from="$OLD_SECRETS_DIR/$name"; to="$SECRETS_DIR/$name"
    [ -s "$from" ] || continue
    if [ -s "$to" ]; then
      cmp -s "$from" "$to" || die "$to differs from $from; the copied database needs the old one"
      continue
    fi
    cp -p "$from" "$to"
    log "copied secret $name from $OLD_SECRETS_DIR"
  done
}

# Stop the old stack and copy its two data volumes into this project's.
# Done after the build so the old stack is down only as long as the copy.
migrate_stack() {
  [ -n "$OLD_PROJECT" ] || return 0
  local new
  new="$(project_name)"
  log "stopping the old stack ($OLD_PROJECT)"
  docker compose -p "$OLD_PROJECT" down
  copy_volume "${OLD_PROJECT}_postgres_data" "${new}_postgres_data" postgres_data "$new"
  copy_volume "${OLD_PROJECT}_uploads" "${new}_uploads" uploads "$new"
}

# Copy one named volume into a fresh one that carries compose's labels, so
# the stack adopts it as its own instead of warning about a foreign volume.
copy_volume() {
  local from="$1" to="$2" key="$3" project="$4"
  if [ "$from" = "$to" ]; then
    log "volume $to is already this project's; reused as is"
    return
  fi
  if docker volume inspect "$to" >/dev/null 2>&1; then
    die "volume $to already exists; remove it with 'docker volume rm $to' to copy $from over it"
  fi
  docker volume create \
    --label "com.docker.compose.project=$project" \
    --label "com.docker.compose.volume=$key" "$to" >/dev/null
  docker run --rm -v "$from:/from:ro" -v "$to:/to" alpine sh -c 'cd /from && cp -a . /to'
  log "copied volume $from -> $to"
}

# ---------------------------------------------------------------------------
# 1. Site configuration -> config/docker/override.json
# ---------------------------------------------------------------------------

# Reject anything that could break the JSON or the URL it ends up in.
valid_hostname() { [[ "$1" =~ ^[A-Za-z0-9.-]+$ ]]; }
valid_base_path() { [[ "$1" =~ ^/([A-Za-z0-9._-]+/)*$ ]]; }
valid_url() { [[ "$1" =~ ^https?://[^[:space:]\"\\]+$ ]]; }

# Ask for the site's values and write them as the override the production
# profile is rendered with. An existing override is kept as it is.
configure_site() {
  if [ -f "$OVERRIDE" ]; then
    log "keeping existing $OVERRIDE"
    return
  fi
  ask SERVER_NAME "Public hostname (as in the browser's address bar)"
  valid_hostname "$SERVER_NAME" || die "hostname '$SERVER_NAME' has characters other than letters, digits, '.' and '-'"
  ask BASE_PATH "URL path the app is served under" "/"
  valid_base_path "$BASE_PATH" || die "base path '$BASE_PATH' must start and end with '/'"
  ask ANTHROPIC_BASE_URL "Anthropic-compatible model endpoint" "https://api.anthropic.com"
  valid_url "$ANTHROPIC_BASE_URL" || die "'$ANTHROPIC_BASE_URL' is not an http(s) URL"
  write_override
  log "wrote $OVERRIDE"
}

# The override file: only what differs from site to site.
write_override() {
  cat > "$OVERRIDE" <<EOF
{
  "anthropic": { "base_url": "$ANTHROPIC_BASE_URL" },
  "nginx": { "server_name": "$SERVER_NAME" },
  "frontend": { "base_path": "$BASE_PATH", "api_url": "${BASE_PATH}api" },
  "secrets_dir": "$SECRETS_DIR"
}
EOF
}

# ---------------------------------------------------------------------------
# 2. Secrets
# ---------------------------------------------------------------------------

# Generate the random secrets and store the API key. gen_secrets.sh leaves
# existing files alone, so the key is only asked for the first time.
configure_secrets() {
  local key_file="$SECRETS_DIR/anthropic_api_key"
  mkdir -p "$SECRETS_DIR"
  chmod 700 "$SECRETS_DIR"
  inherit_secrets
  if [ ! -s "$key_file" ]; then
    ask_secret ANTHROPIC_API_KEY "API key for the model endpoint"
    (umask 077 && printf '%s' "$ANTHROPIC_API_KEY" > "$key_file")
    log "wrote $key_file"
  fi
  SECRETS_DIR="$SECRETS_DIR" "$SCRIPT_DIR/gen_secrets.sh"
}

# ---------------------------------------------------------------------------
# 3. Render .env
# ---------------------------------------------------------------------------

# Whether the host's node, if any, is new enough for gen_env.mjs.
host_node_ok() {
  command -v node >/dev/null || return 1
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 22 ]
}

# Render the production profile plus override into .env, with the host's
# node or, failing that, the same node image the Dockerfile uses.
render_env() {
  if host_node_ok; then
    node "$SCRIPT_DIR/gen_env.mjs" "$PROFILE" --force
    return
  fi
  log "no Node >= 22 on the host; rendering .env with $NODE_IMAGE"
  docker run --rm -v "$ROOT_DIR:/app" -w /app "$NODE_IMAGE" \
    node scripts/gen_env.mjs "$PROFILE" --force
}

# Refuse to run a stack whose login accepts any password.
check_auth_mode() {
  local mode
  mode="$(sed -n 's/^AUTH_MODE=//p' "$ENV_FILE")"
  if [ "real" != "$mode" ]; then
    die "AUTH_MODE is '$mode' in $ENV_FILE; a server must use 'real'"
  fi
}

# ---------------------------------------------------------------------------
# 4. Images
# ---------------------------------------------------------------------------

# Pull the stock images and build ours. This is the slow step.
build_images() {
  log "pulling images"
  docker compose pull --ignore-buildable
  log "building images (this takes a few minutes)"
  docker compose build
}

# ---------------------------------------------------------------------------
# 5. systemd service
# ---------------------------------------------------------------------------

# Fill the unit template in and (re)start the service.
install_service() {
  local unit="$UNIT_DIR/$SERVICE.service" docker_bin
  docker_bin="$(command -v docker)"
  sed -e "s|@ROOT@|$ROOT_DIR|g" -e "s|@DOCKER@|$docker_bin|g" "$UNIT_TEMPLATE" > "$unit"
  chmod 644 "$unit"
  log "installed $unit"
  systemctl daemon-reload
  systemctl enable "$SERVICE" >/dev/null
  log "starting $SERVICE (waits for every container to be healthy)"
  systemctl restart "$SERVICE"
}

# ---------------------------------------------------------------------------
# 6. First login
# ---------------------------------------------------------------------------

# Ask whether a login should be made, and collect it. Done before the build
# so nobody has to wait at the terminal for it. A blank username skips it.
collect_admin() {
  ADMIN_USER="${AIM_HI_ADMIN_USER-}"
  if [ -z "$ADMIN_USER" ]; then
    if ! interactive; then return; fi
    if ! confirm MAKE_ADMIN "Create a login now? (y/n)" "y"; then return; fi
    ask ADMIN_USER "Username"
  fi
  ask ADMIN_EMAIL "Email"
  ask_secret ADMIN_PASSWORD "Password"
}

# Insert the collected login through the running stack.
create_admin() {
  if [ -z "$ADMIN_USER" ]; then return; fi
  printf '%s\n' "$ADMIN_PASSWORD" | "$SCRIPT_DIR/inject_user.sh" "$ADMIN_USER" "$ADMIN_EMAIL"
}

# ---------------------------------------------------------------------------

# What was set up and what is still the operator's to do.
summary() {
  cat >&2 <<EOF

Installed. The stack runs as the '$SERVICE' systemd service:

  systemctl status $SERVICE          # state of the service
  systemctl restart $SERVICE         # stop and start the stack
  docker compose ps                # each container's state (run in $ROOT_DIR)
  docker compose logs -f app       # application log

The gateway listens on http://127.0.0.1:8080 only. Put a TLS-terminating
reverse proxy in front of it; see "Reverse proxy" in README.md.

Site config:  $OVERRIDE
Secrets:      $SECRETS_DIR
Rendered env: $ENV_FILE
EOF
  [ -n "$OLD_PROJECT" ] || return 0
  cat >&2 <<EOF

The old stack ($OLD_PROJECT) is stopped and its data was copied. Once this
install is confirmed working, its volumes can go:

  docker volume rm ${OLD_PROJECT}_postgres_data ${OLD_PROJECT}_uploads
EOF
}

main() {
  preflight
  configure_site
  configure_secrets
  collect_admin
  render_env
  check_auth_mode
  build_images
  migrate_stack
  install_service
  create_admin
  summary
}

main "$@"
