#!/usr/bin/env bash
# Download the Node.js binary and package it inside a macOS Helper App bundle.
#
# On macOS, processes running from inside an .app bundle inherit the parent
# bundle's GUI properties. By placing node inside NodeHelper.app with
# LSUIElement=true, macOS treats it as a background-only process and does NOT
# show Dock/menu-bar icons.
#
# Output: resources/NodeHelper.app/Contents/{Info.plist, MacOS/node}
#
# Usage: bash scripts/download-node.sh [NODE_VERSION]
# Default version: 22.14.0 (LTS)
set -euo pipefail

NODE_VERSION="${1:-22.22.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HELPER_APP="$ROOT/resources/NodeHelper.app"
HELPER_MACOS="$HELPER_APP/Contents/MacOS"
DEST="$HELPER_MACOS/node"

# Detect platform / architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64)  PLATFORM="darwin-arm64" ;;
      x86_64) PLATFORM="darwin-x64" ;;
      *) echo "Unsupported macOS arch: $ARCH"; exit 1 ;;
    esac
    NODE_ARCHIVE="node-v${NODE_VERSION}-${PLATFORM}.tar.gz"
    NODE_BIN_PATH="node-v${NODE_VERSION}-${PLATFORM}/bin/node"
    ;;
  Linux)
    case "$ARCH" in
      x86_64)  PLATFORM="linux-x64" ;;
      aarch64) PLATFORM="linux-arm64" ;;
      *) echo "Unsupported Linux arch: $ARCH"; exit 1 ;;
    esac
    NODE_ARCHIVE="node-v${NODE_VERSION}-${PLATFORM}.tar.gz"
    NODE_BIN_PATH="node-v${NODE_VERSION}-${PLATFORM}/bin/node"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    case "$ARCH" in
      x86_64) PLATFORM="win-x64" ;;
      *) echo "Unsupported Windows arch: $ARCH"; exit 1 ;;
    esac
    NODE_ARCHIVE="node-v${NODE_VERSION}-${PLATFORM}.zip"
    NODE_BIN_PATH="node-v${NODE_VERSION}-${PLATFORM}/node.exe"
    ;;
  *) echo "Unsupported OS: $OS"; exit 1 ;;
esac

if [ -f "$DEST" ]; then
  echo "✓ Node.js binary already present: $DEST"
  exit 0
fi

mkdir -p "$HELPER_MACOS"

DOWNLOAD_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}"
TMPDIR="$(mktemp -d)"
trap "rm -rf $TMPDIR" EXIT

echo "Downloading Node.js v${NODE_VERSION} for ${PLATFORM}..."
curl -fsSL "$DOWNLOAD_URL" -o "$TMPDIR/$NODE_ARCHIVE"

echo "Extracting..."
if [[ "$NODE_ARCHIVE" == *.zip ]]; then
  unzip -q "$TMPDIR/$NODE_ARCHIVE" -d "$TMPDIR"
else
  tar -xzf "$TMPDIR/$NODE_ARCHIVE" -C "$TMPDIR"
fi

cp "$TMPDIR/$NODE_BIN_PATH" "$DEST"
chmod +x "$DEST"

# Create Info.plist for the helper app (macOS icon suppression)
cat > "$HELPER_APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key>
    <string>com.clawz.node-helper</string>
    <key>CFBundleExecutable</key>
    <string>node</string>
    <key>CFBundleName</key>
    <string>ClawZ Node Helper</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSUIElement</key>
    <true/>
    <key>LSBackgroundOnly</key>
    <true/>
</dict>
</plist>
PLIST

echo "✓ Node.js binary saved: $DEST"
echo "✓ NodeHelper.app created: $HELPER_APP"
