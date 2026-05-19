#!/bin/sh
# Build the current checkout and replace /Applications/GitBar.app with it.
# Use this to test a local change against the same .app you launch from
# Spotlight or the Dock, instead of running `npm run tauri dev`.
#
# Usage: npm run install:local
#
# What it does:
#   1. Builds the release .app only (no DMG — faster, ~30s on a warm cache).
#   2. Quits any running GitBar.
#   3. Atomically swaps /Applications/GitBar.app with the freshly built one.
#   4. Strips the macOS quarantine attribute so Gatekeeper doesn't re-prompt.
#   5. Launches GitBar.

set -e

cd "$(dirname "$0")/.."

APP_BUILD_PATH="src-tauri/target/release/bundle/macos/GitBar.app"
APP_INSTALL_PATH="/Applications/GitBar.app"

printf '→ Building release .app (no DMG)…\n'
npm run tauri build -- --bundles app

if [ ! -d "$APP_BUILD_PATH" ]; then
  printf 'install-local: build did not produce %s\n' "$APP_BUILD_PATH" >&2
  exit 1
fi

printf '→ Quitting any running GitBar…\n'
osascript -e 'tell application "GitBar" to quit' >/dev/null 2>&1 || true
pkill -x GitBar >/dev/null 2>&1 || true
# Give the process a moment to release file handles in /Applications.
sleep 1

printf '→ Replacing %s…\n' "$APP_INSTALL_PATH"
# Stage to a sibling path, then rename — atomic on the same filesystem so a
# partial copy never leaves a half-written .app at the install location.
STAGING="$APP_INSTALL_PATH.staging"
rm -rf "$STAGING"
cp -R "$APP_BUILD_PATH" "$STAGING"
rm -rf "$APP_INSTALL_PATH"
mv "$STAGING" "$APP_INSTALL_PATH"

xattr -dr com.apple.quarantine "$APP_INSTALL_PATH" >/dev/null 2>&1 || true

printf '→ Launching GitBar…\n'
open -a GitBar

printf 'Done.\n'
