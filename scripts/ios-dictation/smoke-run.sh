#!/bin/bash
# Build the dictation smoke, put it on the phone, run it, and bring back the
# console log and the JSON verdict.
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

step "bun install"
bun install >/dev/null

step "port 1420"
lsof -ti tcp:1420 | xargs kill -9 2>/dev/null || true

step "generated project"
# gen/apple is ignored and stale: it keeps whichever identifier the last run
# wrote, and only `tauri ios init` rewrites it.
if ! grep -q "PRODUCT_BUNDLE_IDENTIFIER: $DEV_ID\$" src-tauri/gen/apple/project.yml 2>/dev/null; then
  rm -rf src-tauri/gen/apple
  bun run tauri ios init --ci 2>&1 | tail -2
fi

rm -rf src-tauri/gen/apple/build

step "build (VITE_SMOKE=dictation)"
sudo -A launchctl asuser "$GUI_UID" sudo -u "$GUI_USER" \
  /bin/bash -lc "cd '$REPO' && export PATH='$PATH' APPLE_DEVELOPMENT_TEAM=$TEAM \
    APPLE_API_KEY=$APPLE_API_KEY APPLE_API_ISSUER=$APPLE_API_ISSUER \
    APPLE_API_KEY_PATH=$APPLE_API_KEY_PATH VITE_SMOKE=dictation && \
    bun run tauri ios build --debug --target aarch64 --export-method debugging" 2>&1 | tail -5

IPA=$(find src-tauri/gen/apple/build -name '*.ipa' -type f | head -1)
echo "ipa: $IPA"

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
xcrun devicectl device install app --device "$DEVICE" "$IPA" 2>&1 | tail -3

step "console + speaker"
bash /tmp/syslog.sh /tmp/rp-dict.log
( nohup bash /tmp/speaker.sh /tmp/rp-dict.log > /tmp/speaker.log 2>&1 < /dev/null & )
sleep 2

step "launch"
xcrun devicectl device process launch --device "$DEVICE" "$DEV_ID" 2>&1 | tail -2
echo "started at $(date +%H:%M:%S)"
