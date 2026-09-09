#!/bin/sh
set -eu

# Materialize the submitted program into the tmpfs workspace, then become
# it. Stdin is left untouched so it reaches the program.
if [ -z "${CODE_B64:-}" ]; then
  echo "runner: CODE_B64 is not set" >&2
  exit 2
fi
printf '%s' "$CODE_B64" | base64 -d > /workspace/main.py
unset CODE_B64
exec python3 /workspace/main.py
