#!/usr/bin/env bash
# Build ClawZ DMG with build-number-stamped filename.
# Usage: bash scripts/build-dmg.sh
#
# Output example: ClawZ_0.1.0+72_aarch64.dmg
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Determine architecture
ARCH=$(uname -m)
case "$ARCH" in
  arm64) ARCH_LABEL="aarch64" ;;
  x86_64) ARCH_LABEL="x86_64" ;;
  *) ARCH_LABEL="$ARCH" ;;
esac

# Pre-build: ensure bundled Node.js binary + openclaw package are present
bash "$ROOT/scripts/download-node.sh"
bash "$ROOT/scripts/bundle-openclaw.sh"

# Run the Tauri build (gen-build-info.sh runs automatically via beforeBuildCommand)
cd "$ROOT"
pnpm tauri build

# Read version info from the generated buildInfo.ts
BASE_VERSION=$(grep 'APP_VERSION' "$ROOT/src/lib/buildInfo.ts" | sed 's/.*"\(.*\)".*/\1/')
BUILD_NUMBER=$(grep 'BUILD_NUMBER' "$ROOT/src/lib/buildInfo.ts" | sed 's/[^0-9]//g')

# Move DMG to releases/ (outside Tauri's build dir, which gets cleared on next build)
DMG_DIR="$ROOT/src-tauri/target/release/bundle/dmg"
SRC_DMG="$DMG_DIR/ClawZ_${BASE_VERSION}_${ARCH_LABEL}.dmg"
RELEASES_DIR="$ROOT/releases"
mkdir -p "$RELEASES_DIR"
FINAL_DMG="$RELEASES_DIR/ClawZ_${BASE_VERSION}+${BUILD_NUMBER}_${ARCH_LABEL}.dmg"

if [ -f "$SRC_DMG" ]; then
  mv "$SRC_DMG" "$FINAL_DMG"
  echo ""
  echo "✓ DMG ready: $FINAL_DMG"
else
  echo "Warning: Expected DMG not found at $SRC_DMG"
  echo "Available DMGs:"
  ls -la "$DMG_DIR"/*.dmg 2>/dev/null || echo "  (none)"
fi
