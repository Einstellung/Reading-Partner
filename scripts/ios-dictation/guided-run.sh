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

step "bundle id"
if grep -q '"identifier": "com.xinyuan.readingpartner"' src-tauri/tauri.conf.json; then
  sed -i '' "s|\"identifier\": \"com.xinyuan.readingpartner\"|\"identifier\": \"$DEV_ID\"|" \
    src-tauri/tauri.conf.json
fi
grep '"identifier"' src-tauri/tauri.conf.json

rm -rf src-tauri/gen/apple/build

step "build (VITE_SMOKE=dictation-guided)"
sudo -A launchctl asuser "$GUI_UID" sudo -u "$GUI_USER" \
  /bin/bash -lc "cd '$REPO' && export PATH='$PATH' APPLE_DEVELOPMENT_TEAM=$TEAM VITE_SMOKE=dictation-guided && bun run tauri ios build --debug --target aarch64" 2>&1 | tail -4

IPA=$(find src-tauri/gen/apple/build -name '*.ipa' -type f | head -1)
echo "ipa: $IPA"
[ -n "$IPA" ] || { echo "no .ipa produced"; exit 1; }

step "kill any stale instance"
for pid in $(xcrun devicectl device info processes --device "$DEVICE" 2>/dev/null \
             | grep "Reading Partner.app" | awk '{print $1}'); do
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
