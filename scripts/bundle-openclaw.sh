#!/usr/bin/env bash
# Install the openclaw npm package into resources/openclaw/ so it can be
# bundled as a Tauri resource alongside the app.
#
# Usage: bash scripts/bundle-openclaw.sh [OPENCLAW_VERSION]
# Default: installs the latest published version.
set -euo pipefail

OPENCLAW_VERSION="${1:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCES_DIR="$ROOT/resources/openclaw"
mkdir -p "$RESOURCES_DIR"

# Check if already installed (and not forcing a refresh)
if [ -f "$RESOURCES_DIR/node_modules/openclaw/openclaw.mjs" ] && [ -z "$OPENCLAW_VERSION" ]; then
  INSTALLED=$(node -e "try{console.log(require('$RESOURCES_DIR/node_modules/openclaw/package.json').version)}catch(e){}" 2>/dev/null || true)
  if [ -n "$INSTALLED" ]; then
    echo "✓ openclaw@${INSTALLED} already bundled at $RESOURCES_DIR"
    exit 0
  fi
fi

if [ -n "$OPENCLAW_VERSION" ]; then
  PACKAGE="openclaw@${OPENCLAW_VERSION}"
else
  PACKAGE="openclaw"
fi

echo "Installing ${PACKAGE} into $RESOURCES_DIR ..."

# Initialise a minimal package.json if absent (suppresses npm warnings)
if [ ! -f "$RESOURCES_DIR/package.json" ]; then
  echo '{"name":"openclaw-bundle","private":true}' > "$RESOURCES_DIR/package.json"
fi

npm install --prefix "$RESOURCES_DIR" --save "$PACKAGE" --no-fund --no-audit --legacy-peer-deps

INSTALLED=$(node -e "console.log(require('$RESOURCES_DIR/node_modules/openclaw/package.json').version)" 2>/dev/null || echo "unknown")
echo "✓ openclaw@${INSTALLED} bundled at $RESOURCES_DIR"
