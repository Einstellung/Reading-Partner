#!/bin/bash
# Build the guided dictation measurement, put it on the phone, and launch it.
#
# This is the run a person stands in front of. Nothing here starts speaker.sh:
# the whole point is a human voice into the microphone, and a loudspeaker in the
# room would contaminate both numbers it exists to measure.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin"
export SUDO_ASKPASS="$HOME/.askpass.sh"

REPO="$HOME/Reading-Partner"
GUI_UID=501
GUI_USER=mima1234
TEAM=NNXRL2S9SA
DEV_ID=com.xinyuan.readingpartner.dev
# What the icon says, so it cannot be confused with the TestFlight build.
DEV_NAME="RP DEV"
DEVICE=00008140-000C31641EEB001C

cd "$REPO"
step() { printf '\n=== %s ===\n' "$1"; }

step "make sure nothing is speaking"
pkill -f speaker.sh 2>/dev/null || true
pkill -x say 2>/dev/null || true

step "bun install"
bun install >/dev/null

step "port 1420"
lsof -ti tcp:1420 | xargs kill -9 2>/dev/null || true

step "bundle id and display name"
# Both are local-only and neither may be committed. The name matters as much as
# the id: the TestFlight build is installed under the same bundle name, so the
# home screen shows two icons both reading "Reading Partner" and the user opens
# whichever one they find. On 2026-08-17 that cost a night — they opened the
# TestFlight one, saw the ordinary app, and there was no button to tap.
if grep -q '"identifier": "com.xinyuan.readingpartner"' src-tauri/tauri.conf.json; then
  sed -i '' "s|\"identifier\": \"com.xinyuan.readingpartner\"|\"identifier\": \"$DEV_ID\"|" \
    src-tauri/tauri.conf.json
fi
if grep -q '"productName": "Reading Partner"' src-tauri/tauri.conf.json; then
  sed -i '' "s|\"productName\": \"Reading Partner\"|\"productName\": \"$DEV_NAME\"|" \
    src-tauri/tauri.conf.json
fi
grep -E '"identifier"|"productName"' src-tauri/tauri.conf.json

# productName reaches the home screen through gen/apple/project.yml, which only
# `tauri ios init` rewrites — a stale gen/apple keeps the old name however many
# times tauri.conf.json changes.
if ! grep -q "$DEV_NAME" src-tauri/gen/apple/project.yml 2>/dev/null; then
  echo "regenerating gen/apple so the display name takes"
  rm -rf src-tauri/gen/apple
  bun run tauri ios init --ci 2>&1 | tail -2
fi

rm -rf src-tauri/gen/apple/build

step "build (VITE_SMOKE=dictation-guided)"
sudo -A launchctl asuser "$GUI_UID" sudo -u "$GUI_USER" \
  /bin/bash -lc "cd '$REPO' && export PATH='$PATH' APPLE_DEVELOPMENT_TEAM=$TEAM VITE_SMOKE=dictation-guided && bun run tauri ios build --debug --target aarch64" 2>&1 | tail -4

IPA=$(find src-tauri/gen/apple/build -name '*.ipa' -type f | head -1)
echo "ipa: $IPA"
[ -n "$IPA" ] || { echo "no .ipa produced"; exit 1; }

step "kill any stale instance"
for pid in $(xcrun devicectl device info processes --device "$DEVICE" 2>/dev/null \
             | grep "$DEV_NAME.app" | awk '{print $1}'); do
  echo "terminating $pid"
  xcrun devicectl device process signal --device "$DEVICE" --pid "$pid" --signal SIGKILL >/dev/null 2>&1 || true
done

step "install"
xcrun devicectl device install app --device "$DEVICE" "$IPA" 2>&1 | tail -3

step "console"
bash /tmp/syslog.sh /tmp/rp-guided.log

step "launch"
xcrun devicectl device process launch --device "$DEVICE" "$DEV_ID" 2>&1 | tail -2
echo "launched at $(date +%H:%M:%S) — the phone is now waiting for a tap"
