#!/usr/bin/env bash
set -euo pipefail

# deploy_remote.sh
#
# The server half of scripts/deploy.sh, run there as root. It unpacks a
# bundle into the install root, removes the files the previous deploy put
# there that this bundle no longer has, and hands over to the unpacked
# tree's scripts/install.sh.
#
# Only entries of the previous bundle's file list, kept in BUNDLE.files at
# the install root, are ever removed. Files that never came from a bundle,
# such as .env and config/docker/override.json, are left alone.
#
# Usage, which deploy.sh takes care of after uploading this script next to
# the bundle:
#   sudo deploy_remote.sh <bundle.tar.gz> <install-root> <admin: y|n>
#
# On an update, admin 'n' skips the installer's offer to create a login.

BUNDLE="${1-}"
INSTALL_ROOT="${2-}"
ADMIN="${3-n}"
MANIFEST_NAME="BUNDLE.files"

log() { echo "==> $*" >&2; }
die() { echo "error: $*" >&2; exit 1; }

# The arguments and the caller.
preflight() {
  if [ -z "$BUNDLE" ] || [ -z "$INSTALL_ROOT" ]; then
    die "usage: deploy_remote.sh <bundle.tar.gz> <install-root> <admin: y|n>"
  fi
  [ "$(id -u)" -eq 0 ] || die "run as root"
  [ -f "$BUNDLE" ] || die "no bundle at $BUNDLE"
  case "$INSTALL_ROOT" in
    /*) ;;
    *) die "install root '$INSTALL_ROOT' must be an absolute path" ;;
  esac
}

# A missing install root is created as root's. An existing one keeps its
# owner, group and mode, which install.sh then applies to the whole tree.
ensure_install_root() {
  [ -d "$INSTALL_ROOT" ] || install -d -m 755 -o root -g root "$INSTALL_ROOT"
}

# A bundle never carries a symlink, so one in the tree is foreign, and the
# prune and the extraction below would write through it.
refuse_symlinks() {
  local link
  link="$(find "$INSTALL_ROOT" -type l -print -quit)"
  [ -z "$link" ] || die "$link is a symlink; the install tree may not contain any"
}

# Remove what the previous deploy had and this bundle lacks, unpack the
# bundle, and keep its file list for the next deploy.
unpack() {
  local new old entry
  refuse_symlinks
  new="$(mktemp)"
  old="$INSTALL_ROOT/$MANIFEST_NAME"
  tar -tzf "$BUNDLE" | LC_ALL=C sort > "$new"
  grep -qx BUNDLE "$new" || die "$BUNDLE was not made by scripts/bundle.sh"
  if [ -f "$old" ]; then
    LC_ALL=C sort "$old" | LC_ALL=C comm -13 "$new" - | while IFS= read -r entry; do
      remove_stale "$entry"
    done
  fi
  umask 022
  tar -xzf "$BUNDLE" -C "$INSTALL_ROOT"
  install -m 644 "$new" "$old"
  rm -f "$new"
}

# Remove one file of the previous deploy. Only a plain relative path to a
# regular file qualifies.
remove_stale() {
  case "$1" in
    ""|/*|*/|..|../*|*/..|*/../*) return 0 ;;
  esac
  [ -f "$INSTALL_ROOT/$1" ] || return 0
  rm -f -- "$INSTALL_ROOT/$1"
  log "removed stale $1"
}

# Hand over to the unpacked installer. On an update it is kept from asking
# about a login unless that was asked for; a first install still offers it.
run_installer() {
  rm -f -- "$BUNDLE"
  if [ "$ADMIN" = n ] && [ -f "$INSTALL_ROOT/config/docker/override.json" ]; then
    export AIM_HI_MAKE_ADMIN=n
  fi
  cd "$INSTALL_ROOT"
  exec scripts/install.sh
}

main() {
  preflight
  ensure_install_root
  log "unpacking into $INSTALL_ROOT"
  unpack
  run_installer
}

main "$@"
