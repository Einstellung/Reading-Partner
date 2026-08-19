#!/bin/bash
# Build the interactive dictation bench, put it on the phone and launch it.
#
# The bench is the one entry point meant for a person rather than a harness:
# VITE_SMOKE=dictation-bench mounts the real composer and nothing else, so
# hold-to-talk can be tried by hand on a build that cannot sign in. No speaker,
# no result file, no fetch step — the phone is the output.
#
# Same four traps as ios-dev.sh, which is where they are explained.
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

cd "$REPO"
step() { printf '\n=== %s ===\n' "$1"; }

step "bun install"
bun install >/dev/null

step "port 1420"
lsof -ti tcp:1420 | xargs kill -9 2>/dev/null || true

step "bundle id and display name"
# Local-only, never committed: the real identifier has Google's reversed client
# id baked into CFBundleURLTypes at build time and is owned by the paid team.
if grep -q '"identifier": "com.xinyuan.readingpartner"' src-tauri/tauri.conf.json; then
  sed -i '' "s|\"identifier\": \"com.xinyuan.readingpartner\"|\"identifier\": \"$DEV_ID\"|" \
    src-tauri/tauri.conf.json
fi
if grep -q '"productName": "Reading Partner"' src-tauri/tauri.conf.json; then
  sed -i '' "s|\"productName\": \"Reading Partner\"|\"productName\": \"$DEV_NAME\"|" \
    src-tauri/tauri.conf.json
fi
grep -E '"identifier"|"productName"' src-tauri/tauri.conf.json

if ! grep -q "$DEV_NAME" src-tauri/gen/apple/project.yml 2>/dev/null; then
  echo "regenerating gen/apple so the display name takes"
  rm -rf src-tauri/gen/apple
  bun run tauri ios init --ci 2>&1 | tail -2
fi

rm -rf src-tauri/gen/apple/build

step "build (VITE_SMOKE=dictation-bench)"
sudo -A launchctl asuser "$GUI_UID" sudo -u "$GUI_USER" \
  /bin/bash -lc "cd '$REPO' && export PATH='$PATH' APPLE_DEVELOPMENT_TEAM=$TEAM VITE_SMOKE=dictation-bench && bun run tauri ios build --debug --target aarch64" 2>&1 | tail -5

IPA=$(find src-tauri/gen/apple/build -name '*.ipa' -type f | head -1)
echo "ipa: $IPA"
[ -n "$IPA" ] || { echo "no .ipa produced"; exit 1; }

step "kill any stale instance"
# install does not stop a running instance, and two of them fight over the audio
# session (docs/pitfall/138).
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

step "launch"
# The phone has to be unlocked for this to do anything at all.
xcrun devicectl device process launch --device "$DEVICE" "$DEV_ID" 2>&1 | tail -2
echo "started at $(date +%H:%M:%S)"
