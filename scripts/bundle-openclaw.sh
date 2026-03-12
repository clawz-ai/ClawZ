#!/usr/bin/env bash
# Install the openclaw npm package into resources/openclaw/ so it can be
# bundled as a Tauri resource alongside the app.
#
# Usage: bash scripts/bundle-openclaw.sh [OPENCLAW_VERSION] [TARGET_TRIPLE]
# Default: installs the latest published version for the host architecture.
# TARGET_TRIPLE: optional Rust target triple (e.g., "x86_64-apple-darwin")
#                to install native addons for the correct architecture when
#                cross-compiling (useful for building x64 on arm64).
set -euo pipefail

OPENCLAW_VERSION="${1:-}"
TARGET_TRIPLE="${2:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCES_DIR="$ROOT/resources/openclaw"
mkdir -p "$RESOURCES_DIR"

# When cross-compiling, tell npm to fetch native addons for the target arch.
# This is critical: without it, native .node bindings (e.g., @snazzah/davey)
# will be installed for the host arch and crash at runtime on the target.
# Uses npm --cpu/--os flags to control optional dependency platform resolution.
NPM_CROSS_FLAGS=""
if [ -n "$TARGET_TRIPLE" ]; then
  case "$TARGET_TRIPLE" in
    aarch64-apple-darwin)        NPM_CROSS_FLAGS="--cpu=arm64 --os=darwin" ;;
    x86_64-apple-darwin)         NPM_CROSS_FLAGS="--cpu=x64 --os=darwin" ;;
    x86_64-unknown-linux-gnu)    NPM_CROSS_FLAGS="--cpu=x64 --os=linux" ;;
    aarch64-unknown-linux-gnu)   NPM_CROSS_FLAGS="--cpu=arm64 --os=linux" ;;
    *) echo "Unknown target triple: $TARGET_TRIPLE"; exit 1 ;;
  esac
  echo "Cross-compiling: $NPM_CROSS_FLAGS"
  # Force reinstall to ensure native bindings match target arch
  rm -rf "$RESOURCES_DIR/node_modules"
fi

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

npm install --prefix "$RESOURCES_DIR" --save "$PACKAGE" --no-fund --no-audit --legacy-peer-deps $NPM_CROSS_FLAGS

INSTALLED=$(node -e "console.log(require('$RESOURCES_DIR/node_modules/openclaw/package.json').version)" 2>/dev/null || echo "unknown")
echo "✓ openclaw@${INSTALLED} bundled at $RESOURCES_DIR"
