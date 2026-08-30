#!/bin/bash
# Build the turn probe, put it on the phone, push the fixture and let it run
# (docs/33, M-voice-3).
#
#   turn-run.sh [seconds to wait] [fixture dir]
#
# It answers three questions in one pass: whether SpeechDetector reports
# anything, what finalize(through: nil) costs in milliseconds and in words, and
# what this build's tap delivery and this placement's levels look like. No
# vendor and no network — nothing here synthesises, so there is no key to pass.
#
# Somebody has to be in front of the phone. The screen says when to read and
# what; five readings of four seconds each, about four minutes end to end.
# Same four traps as ios-dev.sh, which is where they are explained.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin"
export SUDO_ASKPASS="$HOME/.askpass.sh"

REPO="$HOME/Reading-Partner"
GUI_UID=501
GUI_USER=mima1234
[ -f "$HOME/.asc-env" ] && . "$HOME/.asc-env"
TEAM=${APPLE_DEVELOPMENT_TEAM:?APPLE_DEVELOPMENT_TEAM is unset; see ~/.asc-env}
DEV_ID=com.xinyuan.readingpartner.dev
DEV_NAME="Reading Partner"
DEVICE=00008140-000C31641EEB001C
FRESH=${FRESH:-0}
RUNLOG=${RUNLOG:-$HOME/rp-turn-$(date +%m%d-%H%M%S)}
# One full pass is about 75 s and the two sensitivity passes about 40 s each,
# plus the boot and the gaps. The sweep is skipped outright when the first pass
# reports no detector results, so a dead-end answer comes back in half of this.
WAIT=${1:-320}
FIXTURE=${2:-$HOME/rp-speech-fixture}
PHASE=${PHASE:-all}
case "$PHASE" in
  build | device | all) ;;
  *)
    echo "PHASE is $PHASE; it has to be build, device or all."
    exit 1
    ;;
esac

cd "$REPO"
step() { printf '\n=== %s ===\n' "$1"; }

# tauri.conf.json's identifier is the shipping one and installing that would
# replace the build the phone has from TestFlight. Overridden at the source
# through the config merge, because `tauri ios build` regenerates gen/apple from
# the config on every run.
BENCH_CONFIG=/tmp/rp-bench-id.json
printf '{"identifier": "%s"}\n' "$DEV_ID" > "$BENCH_CONFIG"

if [ "$PHASE" != device ]; then

step "bun install"
bun install >/dev/null

step "port 1420"
lsof -ti tcp:1420 | xargs kill -9 2>/dev/null || true

step "generated project"
if ! grep -q "PRODUCT_BUNDLE_IDENTIFIER: $DEV_ID\$" src-tauri/gen/apple/project.yml 2>/dev/null; then
  rm -rf src-tauri/gen/apple
  bun run tauri ios init --ci --config "$BENCH_CONFIG" 2>&1 | tail -2
fi

rm -rf src-tauri/gen/apple/build

step "build (VITE_SMOKE=turn)"
sudo -A launchctl asuser "$GUI_UID" sudo -u "$GUI_USER" \
  /bin/bash -lc "cd '$REPO' && export PATH='$PATH' APPLE_DEVELOPMENT_TEAM=$TEAM \
    APPLE_API_KEY=$APPLE_API_KEY APPLE_API_ISSUER=$APPLE_API_ISSUER \
    APPLE_API_KEY_PATH=$APPLE_API_KEY_PATH VITE_SMOKE=turn && \
    bun run tauri ios build --debug --target aarch64 --export-method debugging \
      --config '$BENCH_CONFIG'" 2>&1 | tail -5

fi  # PHASE != device

IPA=${IPA_PATH:-$(find src-tauri/gen/apple/build -name '*.ipa' -type f | head -1)}
echo "ipa: $IPA"
[ -n "$IPA" ] || { echo "no .ipa to install; run PHASE=build first"; exit 1; }

# What matters is the identifier inside the bundle about to be installed, not
# the one the build was asked for. Installing the wrong one replaces the app the
# phone has from TestFlight, which has already happened once.
BUILT_ID=$(unzip -p "$IPA" "Payload/$DEV_NAME.app/Info.plist" 2>/dev/null \
  | plutil -extract CFBundleIdentifier raw - 2>/dev/null || true)
echo "built bundle id: $BUILT_ID"
if [ "$BUILT_ID" != "$DEV_ID" ]; then
  echo "REFUSING: that .ipa is $BUILT_ID, not $DEV_ID; it would replace the TestFlight build"
  exit 1
fi

if [ "$PHASE" = build ]; then
  echo "built, not installed. Ask for the phone, then: PHASE=device $0"
  exit 0
fi

kill_stale() {
  for pid in $(xcrun devicectl device info processes --device "$DEVICE" 2>/dev/null \
               | grep "$DEV_NAME.app" | awk '{print $1}'); do
    xcrun devicectl device process signal --device "$DEVICE" --pid "$pid" --signal SIGKILL >/dev/null 2>&1 || true
  done
  sleep 2
}

step "console and system log"
pkill -f idevicesyslog 2>/dev/null || true
sleep 1
( nohup idevicesyslog -u "$DEVICE" -p "$DEV_NAME" > "$RUNLOG.app.log" 2>&1 </dev/null & )
( nohup idevicesyslog -u "$DEVICE" -m readingpartner > "$RUNLOG.sys.log" 2>&1 </dev/null & )
sleep 2
pgrep -fl idevicesyslog | head -4
echo "logs: $RUNLOG.{app,sys}.log $RUNLOG.console"

step "kill any stale instance"
kill_stale
if xcrun devicectl device info processes --device "$DEVICE" 2>/dev/null | grep -q "$DEV_NAME.app"; then
  echo "REFUSING TO INSTALL: an instance is still running"
  exit 1
fi

if [ "$FRESH" = 1 ]; then
  step "uninstall, so the container starts empty"
  xcrun devicectl device uninstall app --device "$DEVICE" "$DEV_ID" 2>&1 | tail -2 || true
fi

step "install"
xcrun devicectl device install app --device "$DEVICE" "$IPA" 2>&1 | tail -3

step "first launch, to create the data directory"
xcrun devicectl device process launch --device "$DEVICE" "$DEV_ID" 2>&1 | tail -1
sleep 12
kill_stale

# The played and duplex stages speak the same twelve sentences the playback
# experiments use. Without the fixture those two stages fail and the readings
# they frame are worth much less.
step "push the fixture"
"$(dirname "$0")/push-fixture.sh" "$FIXTURE"

step "launch the run"
echo "SOMEBODY HAS TO HOLD THE PHONE. The screen says when to read."
nohup xcrun devicectl device process launch --console --device "$DEVICE" "$DEV_ID" \
  > "$RUNLOG.console" 2>&1 </dev/null &
CONSOLE_PID=$!
echo "started at $(date +%H:%M:%S); waiting ${WAIT}s"
for _ in $(seq 1 $((WAIT / 30))); do
  sleep 30
  printf '%s last line %ss ago\n' "$(date +%H:%M:%S)" \
    "$(( $(date +%s) - $(stat -f %m "$RUNLOG.app.log" 2>/dev/null || echo 0) ))"
done
kill "$CONSOLE_PID" 2>/dev/null || true

step "fetch"
"$(dirname "$0")/fetch-result.sh" turn-result.json /tmp/turn-result.json

step "logs"
pkill -f idevicesyslog 2>/dev/null || true
idevicecrashreport -u "$DEVICE" -k "$HOME/crash" >/dev/null 2>&1 || true
wc -l "$RUNLOG.app.log" "$RUNLOG.sys.log" "$RUNLOG.console" 2>/dev/null || true
