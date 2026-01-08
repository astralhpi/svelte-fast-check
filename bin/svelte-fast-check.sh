#!/bin/sh
set -e

# Detect the script's directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_PATH="$SCRIPT_DIR/../dist/cli.js"

# Detect runtime: prefer bun if available and in a bun project, otherwise use node
if [ -n "$BUN_INSTALL" ] || [ -f "bun.lockb" ] || [ -f "bun.lock" ] || [ -f "bunfig.toml" ]; then
  if command -v bun >/dev/null 2>&1; then
    exec bun "$CLI_PATH" "$@"
  else
    echo "Warning: Bun project detected, but 'bun' command not found. Falling back to Node.js." >&2
  fi
fi

# Fallback to node
exec node "$CLI_PATH" "$@"
