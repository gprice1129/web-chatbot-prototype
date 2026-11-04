#!/usr/bin/env bash
set -euo pipefail

# deploy.sh
#
# Installs or updates the stack on a remote server from this checkout in one
# step: bundles the tree with scripts/bundle.sh, uploads the bundle over ssh,
# and runs scripts/deploy_remote.sh there under sudo, which unpacks it and
# hands over to scripts/install.sh. Prompts from sudo and from the installer
# reach this terminal, so a first install asks its questions here and an
# update asks nothing.
#
# Usage:
#   scripts/deploy.sh [user@]host [install-root]
#
#   install-root    where the stack lives on the server (default /opt/aim-hi)
#   --allow-dirty   pack uncommitted edits, which is refused otherwise
#   --admin         offer to create a login on an update too
#   --yes           do not ask for confirmation
#
# The server needs an ssh login for that user and sudo for them; everything
# else is the installer's business. ssh settings such as a port or a key
# belong in ~/.ssh/config for the host. Without a terminal here the run is
# unattended, which needs --yes and passwordless sudo on the server.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

HOST=""
INSTALL_ROOT="/opt/aim-hi"
ALLOW_DIRTY=n
ADMIN=n
YES=n
STAGE='~/.cache/aim-hi'
SSH_OPTS=(-o ServerAliveInterval=30 -o ServerAliveCountMax=6)
TMP=""
STAMP=""

log() { echo "==> $*" >&2; }
die() { echo "error: $*" >&2; exit 1; }
usage() { echo "usage: scripts/deploy.sh [--allow-dirty] [--admin] [--yes] [user@]host [install-root]" >&2; }

# Whether there is a terminal to prompt on.
is_interactive() { [ -t 0 ]; }

# Read the flags and the one or two positional arguments.
parse_args() {
  local arg positional=()
  for arg in "$@"; do
    case "$arg" in
      --allow-dirty) ALLOW_DIRTY=y ;;
      --admin) ADMIN=y ;;
      --yes) YES=y ;;
      -h|--help) usage; exit 0 ;;
      -*) usage; die "unknown option '$arg'" ;;
      *) positional+=("$arg") ;;
    esac
  done
  case "${#positional[@]}" in
    1) HOST="${positional[0]}" ;;
    2) HOST="${positional[0]}"; INSTALL_ROOT="${positional[1]}" ;;
    *) usage; exit 2 ;;
  esac
  case "$INSTALL_ROOT" in
    /*) ;;
    *) die "install root '$INSTALL_ROOT' must be an absolute path" ;;
  esac
}

# Refuse to ship edits that are not committed, unless told to.
check_clean() {
  [ "$ALLOW_DIRTY" = n ] || return 0
  local changes
  changes="$(git status --porcelain --untracked-files=no --ignore-submodules=untracked)"
  [ -z "$changes" ] && return 0
  echo "$changes" >&2
  die "the working tree has uncommitted edits; commit them or pass --allow-dirty"
}

# Bundle the tree next to the server-side script and read the stamp.
make_bundle() {
  "$SCRIPT_DIR/bundle.sh" "$TMP/bundle.tar.gz"
  cp "$SCRIPT_DIR/deploy_remote.sh" "$TMP/deploy_remote.sh"
  STAMP="$(tar -xzOf "$TMP/bundle.tar.gz" BUNDLE)"
}

# Show what goes where and ask before touching the server, unless told not to.
confirm_plan() {
  {
    echo
    echo "Deploy to $HOST:$INSTALL_ROOT"
    echo "$STAMP" | sed 's/^/  /'
    echo
  } >&2
  [ "$YES" = n ] || return 0
  is_interactive || die "no terminal to confirm on; pass --yes"
  local answer
  printf 'Continue? [y/N] ' >&2
  read -r answer
  case "$answer" in
    [Yy]*) return 0 ;;
    *) die "aborted" ;;
  esac
}

# Put the bundle and the server-side script in the user's cache on the server.
upload() {
  log "uploading to $HOST:$STAGE"
  tar -C "$TMP" -cf - bundle.tar.gz deploy_remote.sh \
    | ssh "${SSH_OPTS[@]}" "$HOST" "mkdir -p $STAGE && tar -xf - -C $STAGE"
}

# Run the server-side script under sudo. With a terminal here, sudo and the
# installer prompt on it. Without one, sudo must not need a password.
run_remote() {
  local cmd
  cmd="bash $STAGE/deploy_remote.sh $STAGE/bundle.tar.gz $(printf '%q' "$INSTALL_ROOT") $ADMIN"
  log "installing on $HOST"
  if is_interactive; then
    ssh -t "${SSH_OPTS[@]}" "$HOST" "sudo $cmd"
  else
    ssh "${SSH_OPTS[@]}" "$HOST" "sudo -n $cmd"
  fi
}

# The short root commit of the bundle, for the closing line.
bundle_sha() {
  echo "$STAMP" | awk '$1 == "root" { print substr($2, 1, 7) }'
}

main() {
  parse_args "$@"
  check_clean
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  make_bundle
  confirm_plan
  upload
  run_remote
  log "deployed $(bundle_sha) to $HOST:$INSTALL_ROOT"
}

main "$@"
