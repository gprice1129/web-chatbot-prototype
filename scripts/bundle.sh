#!/usr/bin/env bash
set -euo pipefail

# bundle.sh
#
# Packs the checkout, submodules included, into one tarball that a server
# can be installed from without any git access. The server then builds the
# images from this source with scripts/install.sh.
#
# Only tracked files go in, so node_modules, build output, .env, secrets
# and config/docker/override.json stay out, and the script refuses to pack
# at all if one of those was ever force-added. The working tree's contents
# are what is packed, so an uncommitted edit to a tracked file is included;
# the script warns when there are such edits so that is never a surprise.
#
# Every entry is recorded as root's, with no group or world write and no
# setuid, setgid or sticky bit, so that unpacking as root on the server
# does not hand the tree to whichever account happens to have the packer's
# uid there.
#
# A BUNDLE file at the top of the tarball records the root commit and each
# submodule commit, so a server can say what it is running.
#
# Usage:
#   scripts/bundle.sh                 writes build/aim-hi-<sha>.tar.gz
#   scripts/bundle.sh <out.tar.gz>    writes the named file
#
# The tarball has no top-level directory: it unpacks straight into the
# directory given to tar, which becomes the install root and names the
# compose project. scripts/deploy.sh does the rest over ssh; by hand, on
# the server:
#   sudo mkdir -p /opt/aim-hi && sudo tar xzf aim-hi-<sha>.tar.gz -C /opt/aim-hi
#   cd /opt/aim-hi && sudo scripts/install.sh

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# Secrets and machine config are gitignored, but a force-add would still
# track them. Refuse to pack any such file.
check_never_shipped() {
  local found
  found="$(git ls-files --recurse-submodules | grep -E '(^|/)\.env|(^|/)secrets/|(^|/)override\.json$' || true)"
  if [ -n "$found" ]; then
    echo "error: files that must never ship are tracked:" >&2
    echo "$found" | sed 's/^/  /' >&2
    exit 1
  fi
}

# Every submodule must be checked out, or the bundle silently lacks it.
check_submodules() {
  local missing
  missing="$(git submodule status --recursive | awk '/^-/ { print $2 }')"
  if [ -n "$missing" ]; then
    echo "error: submodules not initialised:" >&2
    echo "$missing" | sed 's/^/  /' >&2
    echo "run: git submodule update --init --recursive" >&2
    exit 1
  fi
}

# Say so when what is packed differs from what is committed. Untracked
# files are not packed, so they do not count.
warn_if_dirty() {
  local status_opts=(--untracked-files=no --ignore-submodules=untracked)
  if [ -n "$(git status --porcelain "${status_opts[@]}")" ]; then
    echo "warning: working tree is dirty; the bundle packs uncommitted edits" >&2
    git status --short "${status_opts[@]}" >&2
  fi
}

# The root commit and every submodule commit, one per line.
write_stamp() {
  local stamp="$1"
  {
    echo "root $(git rev-parse HEAD)"
    git submodule status --recursive | awk '{ sub(/^[-+ ]/, "", $1); print $2, $1 }'
    echo "packed $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$stamp"
}

check_never_shipped
check_submodules
warn_if_dirty

SHA="$(git rev-parse --short HEAD)"
OUT="${1:-build/aim-hi-$SHA.tar.gz}"
mkdir -p "$(dirname "$OUT")"

# Pack the tracked files, then append the stamp and compress. Entries are
# recorded as root's with no group or world write and no setuid, setgid or
# sticky bit, whatever the packer's uid, umask and mode bits.
TAR_OPTS=(--owner=0 --group=0 --numeric-owner --mode=go-w,a-st)
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
write_stamp "$TMP/BUNDLE"

git ls-files --recurse-submodules -z \
  | tar --null -T - "${TAR_OPTS[@]}" -cf "$TMP/bundle.tar"
tar -rf "$TMP/bundle.tar" "${TAR_OPTS[@]}" -C "$TMP" BUNDLE
gzip -c "$TMP/bundle.tar" > "$OUT"

echo "wrote $OUT ($(du -h "$OUT" | cut -f1), no top-level directory)" >&2
