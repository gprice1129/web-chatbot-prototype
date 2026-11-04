#!/usr/bin/env bash
set -euo pipefail

# deploy_remote.sh
#
# The server half of scripts/deploy.sh, run there as root. It unpacks a
# bundle into the install root, removes the files the previous deploy put
# there that this bundle no longer has, and hands over to the unpacked
# tree's scripts/install.sh.
#
# Root runs what is in the install root, so before anything is touched the
# root and every directory above it must be root's, writable by nobody else
# and no symlink, and so must everything already in the tree. One deploy
# runs at a time per install root.
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

# Whether a path is owned by root and writable by nobody else.
is_roots_alone() {
  [ "$(stat -c %u -- "$1")" -eq 0 ] && [ -z "$(find "$1" -maxdepth 0 -perm /022)" ]
}

# The install root, or the nearest existing directory above one that is
# still to be created, and every directory up to / must be root's alone
# and no symlink, or another account could swap the tree root works in.
check_path() {
  local dir="$INSTALL_ROOT"
  while [ ! -e "$dir" ]; do dir="$(dirname -- "$dir")"; done
  [ "$(realpath -e -- "$dir")" = "$dir" ] || die "$dir has a symlink in its path; the install root may not"
  while :; do
    is_roots_alone "$dir" || die "$dir must be owned by root and writable by nobody else"
    [ "$dir" != / ] || break
    dir="$(dirname -- "$dir")"
  done
}

# A missing install root is created as root's.
ensure_install_root() {
  [ -d "$INSTALL_ROOT" ] || install -d -m 755 -o root -g root "$INSTALL_ROOT"
}

# One deploy at a time per install root. The lock is held on the directory
# itself and passes to install.sh with the exec below.
lock_install_root() {
  exec 9<"$INSTALL_ROOT"
  flock -n 9 || die "another deploy is running in $INSTALL_ROOT"
}

# Everything already in the tree must be root's, writable by nobody else and
# no symlink: a bundle never carries one, and the prune and the extraction
# below would write through it.
check_tree() {
  local bad
  bad="$(find "$INSTALL_ROOT" \( -type l -o ! -user root -o -perm /022 \) -print -quit)"
  [ -z "$bad" ] || die "$bad: the install tree must be root's, writable by nobody else, and hold no symlink"
}

# Remove what the previous deploy had and this bundle lacks, unpack the
# bundle, and keep its file list for the next deploy.
unpack() {
  local new old entry
  new="$(mktemp)"
  old="$INSTALL_ROOT/$MANIFEST_NAME"
  tar --quoting-style=literal -tzf "$BUNDLE" | LC_ALL=C sort > "$new"
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
  check_path
  ensure_install_root
  lock_install_root
  check_tree
  log "unpacking into $INSTALL_ROOT"
  unpack
  run_installer
}

main "$@"
