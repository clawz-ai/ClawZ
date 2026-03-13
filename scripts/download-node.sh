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
# Usage: bash scripts/download-node.sh [NODE_VERSION] [TARGET_TRIPLE]
# Default version: the exact version pinned in build-manifest.json
# TARGET_TRIPLE: optional Rust target triple (e.g., "aarch64-apple-darwin")
#                to override auto-detected host architecture (useful for cross-compilation)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_VERSION="${1:-$(node "$ROOT/scripts/build-manifest.mjs" get runtime.node.version)}"
TARGET_TRIPLE="${2:-}"

sha256_file() {
  local file="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    echo "No SHA-256 tool available" >&2
    exit 1
  fi
}

# Detect platform / architecture (with optional override)
OS="$(uname -s)"
if [ -n "$TARGET_TRIPLE" ]; then
  case "$TARGET_TRIPLE" in
    aarch64-apple-darwin) OS="Darwin"; ARCH="arm64" ;;
    x86_64-apple-darwin)  OS="Darwin"; ARCH="x86_64" ;;
    x86_64-unknown-linux-gnu) OS="Linux"; ARCH="x86_64" ;;
    aarch64-unknown-linux-gnu) OS="Linux"; ARCH="aarch64" ;;
    *) echo "Unknown target triple: $TARGET_TRIPLE"; exit 1 ;;
  esac
else
  ARCH="$(uname -m)"
fi

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

EXPECTED_SHA256="$(node "$ROOT/scripts/build-manifest.mjs" get "runtime.node.checksums.${PLATFORM}")"

# Platform-specific destination path:
#   macOS  → NodeHelper.app/Contents/MacOS/node  (LSUIElement suppresses Dock icons)
#   Linux  → node/bin/node                        (plain binary; no .app wrapper needed)
if [ "$OS" = "Linux" ]; then
  DEST="$ROOT/resources/node/bin/node"
  mkdir -p "$ROOT/resources/node/bin"
  # Create an empty macOS placeholder so tauri.conf.json resources don't error
  mkdir -p "$ROOT/resources/NodeHelper.app/Contents/MacOS"
else
  HELPER_APP="$ROOT/resources/NodeHelper.app"
  HELPER_MACOS="$HELPER_APP/Contents/MacOS"
  DEST="$HELPER_MACOS/node"
  mkdir -p "$HELPER_MACOS"
  rm -f "$HELPER_APP/.gitkeep" "$HELPER_APP/Contents/.gitkeep"
  # Create an empty Linux placeholder so tauri.conf.json resources don't error
  mkdir -p "$ROOT/resources/node/bin"
fi

# Skip cache check when cross-compiling (existing binary may be wrong arch)
if [ -f "$DEST" ] && [ -z "$TARGET_TRIPLE" ]; then
  INSTALLED_VERSION="$("$DEST" --version 2>/dev/null || true)"
  if [ "$INSTALLED_VERSION" = "v${NODE_VERSION}" ]; then
    echo "✓ Node.js ${INSTALLED_VERSION} already present: $DEST"
    exit 0
  fi
  echo "Node.js binary at $DEST has version ${INSTALLED_VERSION:-unknown}, expected v${NODE_VERSION}; refreshing..."
fi

DOWNLOAD_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}"
TMPDIR="$(mktemp -d)"
trap "rm -rf $TMPDIR" EXIT

echo "Downloading Node.js v${NODE_VERSION} for ${PLATFORM}..."
curl -fsSL "$DOWNLOAD_URL" -o "$TMPDIR/$NODE_ARCHIVE"

ACTUAL_SHA256="$(sha256_file "$TMPDIR/$NODE_ARCHIVE")"
if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
  echo "Checksum mismatch for $NODE_ARCHIVE" >&2
  echo "Expected: $EXPECTED_SHA256" >&2
  echo "Actual:   $ACTUAL_SHA256" >&2
  exit 1
fi

echo "Extracting..."
if [[ "$NODE_ARCHIVE" == *.zip ]]; then
  unzip -q "$TMPDIR/$NODE_ARCHIVE" -d "$TMPDIR"
else
  tar -xzf "$TMPDIR/$NODE_ARCHIVE" -C "$TMPDIR"
fi

cp "$TMPDIR/$NODE_BIN_PATH" "$DEST"
chmod +x "$DEST"

# Create Info.plist for the helper app (macOS icon suppression — macOS only)
if [ "$OS" != "Linux" ]; then
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

  # Ad-hoc sign the bundle WITHOUT Hardened Runtime so V8 JIT works on all
  # architectures without needing entitlements. Hardened Runtime blocks JIT
  # unless allow-jit entitlement is present, but ad-hoc entitlements are not
  # reliably honored on all Intel Mac configurations.
  # Release builds (CI) re-sign with real identity + runtime + entitlements.
  codesign --force --sign "-" "$HELPER_APP"
  echo "✓ NodeHelper.app created and signed: $HELPER_APP"
fi

echo "✓ Node.js binary saved: $DEST"
