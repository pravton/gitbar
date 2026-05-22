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
SIGNING_KEY_PATH=".secrets/tauri-updater.key"

# tauri.conf.json sets bundle.createUpdaterArtifacts: true so CI signs the
# .app.tar.gz alongside the DMG. The bundler hard-errors locally if it
# sees the configured pubkey but no TAURI_SIGNING_PRIVATE_KEY env var.
# Two paths:
#   - Maintainers with .secrets/tauri-updater.key: feed it in so the
#     local build produces signed updater artifacts (useful for
#     end-to-end testing the upgrade flow against a local release).
#   - Anyone else (contributor clones, fresh machines): override the
#     config to skip updater artifacts entirely. install-local exists
#     to test the .app, not the upgrade flow, so this is fine.
EXTRA_TAURI_ARGS=""
if [ -f "$SIGNING_KEY_PATH" ]; then
  # Refuse to source a private signing key that the filesystem has
  # allowed others to read. Any process under another UID, Time Machine
  # backups copied to shared media, etc. could otherwise lift it and
  # sign malicious updates.
  KEY_PERMS="$(stat -f '%Lp' "$SIGNING_KEY_PATH" 2>/dev/null || stat -c '%a' "$SIGNING_KEY_PATH" 2>/dev/null)"
  if [ "$KEY_PERMS" != "600" ]; then
    printf 'install-local: refusing to use %s (permissions are %s, want 600).\n' \
      "$SIGNING_KEY_PATH" "$KEY_PERMS" >&2
    printf '  Fix:    chmod 600 %s\n' "$SIGNING_KEY_PATH" >&2
    printf '  Or:    delete the file to build without signing the updater artifact.\n' >&2
    exit 1
  fi
  TAURI_SIGNING_PRIVATE_KEY="$(cat "$SIGNING_KEY_PATH")"
  export TAURI_SIGNING_PRIVATE_KEY
  # Only default the password to empty when the caller hasn't already
  # provided one. A developer with a password-protected key (or with a
  # password preloaded from a credential helper) would lose it otherwise.
  if [ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD+set}" ]; then
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
  fi
  printf '→ Found local signing key — building with updater artifacts.\n'
else
  EXTRA_TAURI_ARGS='--config {"bundle":{"createUpdaterArtifacts":false}}'
  printf '→ No local signing key at %s — skipping updater artifacts.\n' \
    "$SIGNING_KEY_PATH"
fi

printf '→ Building release .app (no DMG)…\n'
# shellcheck disable=SC2086 # We want word-splitting on EXTRA_TAURI_ARGS.
npm run tauri build -- --bundles app $EXTRA_TAURI_ARGS

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
