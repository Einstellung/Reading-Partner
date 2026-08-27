#!/bin/bash
# Build the unattended playback probe, put it on the phone, push the fixture and
# let it run (docs/33, M-voice-2).
#
# Two launches, not one: the fixture goes into the app's data container and the
# container-relative path of that directory is only knowable from a listing, so
# the app is started once to create it, killed, fed, and started again for the
# real run. Same four traps as ios-dev.sh, which is where they are explained.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin"
export SUDO_ASKPASS="$HOME/.askpass.sh"

REPO="$HOME/Reading-Partner"
GUI_UID=501
GUI_USER=mima1234
TEAM=NNXRL2S9SA
DEV_ID=com.xinyuan.readingpartner.dev
DEV_NAME="RP DEV"
DEVICE=00008140-000C31641EEB001C
MODE=${1:-speech}
WAIT=${2:-420}
FIXTURE=${3:-$HOME/rp-speech-fixture}

cd "$REPO"
step() { printf '\n=== %s ===\n' "$1"; }

step "bun install"
bun install >/dev/null

step "port 1420"
lsof -ti tcp:1420 | xargs kill -9 2>/dev/null || true

step "bundle id and display name"
if grep -q '"identifier": "com.xinyuan.readingpartner"' src-tauri/tauri.conf.json; then
  sed -i '' "s|\"identifier\": \"com.xinyuan.readingpartner\"|\"identifier\": \"$DEV_ID\"|" \
    src-tauri/tauri.conf.json
fi
if grep -q '"productName": "Reading Partner"' src-tauri/tauri.conf.json; then
  sed -i '' "s|\"productName\": \"Reading Partner\"|\"productName\": \"$DEV_NAME\"|" \
    src-tauri/tauri.conf.json
fi

if ! grep -q "$DEV_NAME" src-tauri/gen/apple/project.yml 2>/dev/null; then
  rm -rf src-tauri/gen/apple
  bun run tauri ios init --ci 2>&1 | tail -2
fi
rm -rf src-tauri/gen/apple/build

step "build (VITE_SMOKE=$MODE)"
sudo -A launchctl asuser "$GUI_UID" sudo -u "$GUI_USER" \
  /bin/bash -lc "cd '$REPO' && export PATH='$PATH' APPLE_DEVELOPMENT_TEAM=$TEAM VITE_SMOKE=$MODE && bun run tauri ios build --debug --target aarch64" 2>&1 | tail -5

IPA=$(find src-tauri/gen/apple/build -name '*.ipa' -type f | head -1)
echo "ipa: $IPA"
[ -n "$IPA" ] || { echo "no .ipa produced"; exit 1; }

kill_stale() {
  for pid in $(xcrun devicectl device info processes --device "$DEVICE" 2>/dev/null \
               | grep "$DEV_NAME.app" | awk '{print $1}'); do
    xcrun devicectl device process signal --device "$DEVICE" --pid "$pid" --signal SIGKILL >/dev/null 2>&1 || true
  done
  sleep 2
}

step "kill any stale instance"
kill_stale
if xcrun devicectl device info processes --device "$DEVICE" 2>/dev/null | grep -q "$DEV_NAME.app"; then
  echo "REFUSING TO INSTALL: an instance is still running"
  exit 1
fi

step "install"
xcrun devicectl device install app --device "$DEVICE" "$IPA" 2>&1 | tail -3

step "first launch, to create the data directory"
xcrun devicectl device process launch --device "$DEVICE" "$DEV_ID" 2>&1 | tail -1
sleep 12
kill_stale

step "push the fixture"
"$(dirname "$0")/push-fixture.sh" "$FIXTURE"

step "launch the run"
xcrun devicectl device process launch --device "$DEVICE" "$DEV_ID" 2>&1 | tail -1
echo "started at $(date +%H:%M:%S); waiting ${WAIT}s"
sleep "$WAIT"

step "fetch"
"$(dirname "$0")/fetch-result.sh" speech-result.json /tmp/speech-result.json
for label in trimmed-burst trimmed-measured raw-burst; do
  "$(dirname "$0")/fetch-result.sh" "$label.pcm" "/tmp/$label.pcm" || true
done
