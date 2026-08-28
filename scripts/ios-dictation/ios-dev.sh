#!/bin/bash
# Build Reading Partner for the attached iPhone and install it, from an SSH
# session with no graphical login of its own.
#
# Four traps are baked in, each one measured rather than guessed:
#
#  1. codesign from an SSH session fails with errSecInternalComponent. Neither
#     `security unlock-keychain` nor `set-key-partition-list` helps. The build
#     has to run inside the graphical session's bootstrap namespace:
#       sudo -A launchctl asuser 501 sudo -u mima1234 <cmd>
#     The inner `sudo -u` is not redundant. `launchctl asuser` alone runs as
#     root: Xcode then reports "No Accounts", and DerivedData lands in /var/root.
#  2. sudo in a tty-less SSH command needs SUDO_ASKPASS. It is in ~/.zshenv, but
#     re-exported here because this script overrides the environment.
#  3. Vite's 1420 is strictPort. Whatever holds it has to go first.
#  4. "Directory not empty (os error 66)" is a stale gen/apple/build.
#
#  Plus one that is not a trap so much as a rule: gen/apple is gitignored and
#  goes stale, so it is regenerated whenever the deployment target moves. It
#  never matches tauri.conf.json by luck.
set -euo pipefail

export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin"
export SUDO_ASKPASS="$HOME/.askpass.sh"

REPO="$HOME/Reading-Partner"
GUI_UID=501
GUI_USER=mima1234
# The paid team signs in the cloud: ~/.asc-env carries the App Store Connect
# key that xcodebuild is handed through -allowProvisioningUpdates, so the
# certificate and the profile are made on demand and nothing has to be added to
# Xcode. The bundle identifier is the real one, which is what the device is
# provisioned for.
[ -f "$HOME/.asc-env" ] && . "$HOME/.asc-env"
TEAM=${APPLE_DEVELOPMENT_TEAM:?APPLE_DEVELOPMENT_TEAM is unset; see ~/.asc-env}
DEV_ID=com.xinyuan.readingpartner
DEV_NAME="Reading Partner"
DEVICE=00008140-000C31641EEB001C

cd "$REPO"

step() { printf '\n=== %s ===\n' "$1"; }

# beforeBuildCommand runs `bun run typecheck`, which needs the dev deps. A tree
# that only ever built the app has none of them and fails on tests/support.
step "bun install"
bun install

# --- 3. free the dev-server port ------------------------------------------
step "port 1420"
lsof -ti tcp:1420 | xargs kill -9 2>/dev/null || true

step "generated project"
# gen/apple is ignored and stale: it keeps whichever identifier the last run
# wrote, and only `tauri ios init` rewrites it.
if ! grep -q "PRODUCT_BUNDLE_IDENTIFIER: $DEV_ID\$" src-tauri/gen/apple/project.yml 2>/dev/null; then
  rm -rf src-tauri/gen/apple
  bun run tauri ios init --ci 2>&1 | tail -2
fi

# --- gen/apple, regenerated when the target moved -------------------------
WANT_TARGET=$(python3 -c 'import json;print(json.load(open("src-tauri/tauri.conf.json"))["bundle"]["iOS"]["minimumSystemVersion"])')
HAVE_TARGET=$(grep -m1 'iOS:' src-tauri/gen/apple/project.yml 2>/dev/null | tr -d ' ' | cut -d: -f2 || echo none)
step "deployment target: want $WANT_TARGET, gen/apple has $HAVE_TARGET"
if [ "${1:-}" = "--reinit" ] || [ "$WANT_TARGET" != "$HAVE_TARGET" ]; then
  echo "regenerating gen/apple"
  rm -rf src-tauri/gen/apple
  bun run tauri ios init --ci
else
  # 4. a stale build dir is os error 66 and nothing else.
  rm -rf src-tauri/gen/apple/build
fi
grep -m2 'IPHONEOS_DEPLOYMENT_TARGET' src-tauri/gen/apple/reading-partner.xcodeproj/project.pbxproj || true

# --- 1 + 2. build inside the graphical session ----------------------------
step "build"
sudo -A launchctl asuser "$GUI_UID" sudo -u "$GUI_USER" \
  /bin/bash -lc "cd '$REPO' && export PATH='$PATH' APPLE_DEVELOPMENT_TEAM=$TEAM \
    APPLE_API_KEY=$APPLE_API_KEY APPLE_API_ISSUER=$APPLE_API_ISSUER \
    APPLE_API_KEY_PATH=$APPLE_API_KEY_PATH && \
    bun run tauri ios build --debug --target aarch64 --export-method debugging"

step "artifact"
# `tauri ios build` exports an .ipa; the .app it was built from lives in
# DerivedData. Read the plist off the .app, install the .ipa.
IPA=$(find src-tauri/gen/apple/build -name '*.ipa' -type f | head -1)
APP=$(find "$HOME/Library/Developer/Xcode/DerivedData" -maxdepth 5 -path '*debug-iphoneos*' -name '*.app' -type d 2>/dev/null | head -1)
echo "ipa: $IPA"
echo "app: $APP"
[ -n "$IPA" ] || { echo "no .ipa produced"; exit 1; }

if [ -n "$APP" ]; then
  # Never grep src-tauri/gen/apple for these: Info.ios.plist is merged into the
  # bundle at build time, so the generated template has none of them.
  /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist"
  /usr/libexec/PlistBuddy -c 'Print :MinimumOSVersion' "$APP/Info.plist"
  /usr/libexec/PlistBuddy -c 'Print :NSMicrophoneUsageDescription' "$APP/Info.plist" || echo "NO MIC STRING"
  for key in UIBackgroundModes NSSpeechRecognitionUsageDescription NSLocalNetworkUsageDescription; do
    if /usr/libexec/PlistBuddy -c "Print :$key" "$APP/Info.plist" >/dev/null 2>&1; then
      echo "$key PRESENT (should not be)"
    else
      echo "$key absent, good"
    fi
  done
fi

step "kill any stale instance"
# `devicectl device install app` does NOT stop a running instance, and a smoke
# that has finished still has its result page on screen. Without this, a re-run
# relaunches an app that is already up and you cannot tell a fresh run from the
# last one's leftovers.
#
# The two-instance state pitfall 159 describes is reachable from here in theory
# — the losing instance's configureSession() throws "The microphone is in use by
# something else" — but it has never been observed in the wild. A sighting of
# two pids on 2026-08-17 turned out to be the normal transient during install.
# This guard is here for determinism, not for that.
for pid in $(xcrun devicectl device info processes --device "$DEVICE" 2>/dev/null \
             | grep "$DEV_NAME.app" | awk '{print $1}'); do
  echo "terminating stale pid $pid"
  xcrun devicectl device process signal --device "$DEVICE" --pid "$pid" --signal SIGKILL >/dev/null 2>&1 || true
done
sleep 2
if xcrun devicectl device info processes --device "$DEVICE" 2>/dev/null | grep -q "$DEV_NAME.app"; then
  echo "REFUSING TO INSTALL: an instance is still running"
  exit 1
fi

step "install"
xcrun devicectl device install app --device "$DEVICE" "$IPA"

step "done"
echo "launch: xcrun devicectl device process launch --device $DEVICE $DEV_ID"
