#!/bin/bash
# Run the turn detector's two implementations over the same numbers on the phone
# and print where they disagree (docs/33, docs/45).
#
#   turn-replay-run.sh [seconds to wait]
#
# VoiceTurn.swift is a transliteration of src/info/companion/turn-detect.ts. This
# is what makes that a checkable claim: the app is built with
# VITE_SMOKE=turn-replay, src/smoke/turn-replay.ts hands the device one recorded
# or synthetic level sequence per case, and compares the events the Swift machine
# announces against the events the TypeScript machine announces over the same
# input, position by position.
#
# Unlike turn-run.sh this is arithmetic over a list. Nothing plays, nothing
# listens, no fixture has to be pushed, and nobody has to be in front of the
# phone — the whole pass is over in seconds, which is why the default wait is 30
# and not 320. Same four traps as ios-dev.sh, which is where they are explained.
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
RUNLOG=${RUNLOG:-$HOME/rp-turn-replay-$(date +%m%d-%H%M%S)}
# Seventeen cases of a few hundred multiplications each, plus the webview's own
# start-up. The run is done long before this; the wait is for the boot.
WAIT=${1:-30}
RESULT=${RESULT:-/tmp/turn-replay.json}
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

step "build (VITE_SMOKE=turn-replay)"
sudo -A launchctl asuser "$GUI_UID" sudo -u "$GUI_USER" \
  /bin/bash -lc "cd '$REPO' && export PATH='$PATH' APPLE_DEVELOPMENT_TEAM=$TEAM \
    APPLE_API_KEY=$APPLE_API_KEY APPLE_API_ISSUER=$APPLE_API_ISSUER \
    APPLE_API_KEY_PATH=$APPLE_API_KEY_PATH VITE_SMOKE=turn-replay && \
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
  echo "built, not installed. Plug the phone in, then: PHASE=device $0"
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
sleep 2
pgrep -fl idevicesyslog | head -2
echo "logs: $RUNLOG.app.log $RUNLOG.console"

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

# A previous run's verdict left in the container would be copied back and read as
# this run's, which is exactly the failure this script was written to remove.
step "clear the previous verdict"
rm -f /tmp/turn-replay-previous.json
"$(dirname "$0")/fetch-result.sh" turn-replay.json /tmp/turn-replay-previous.json >/dev/null 2>&1 \
  && echo "there was one; it is at /tmp/turn-replay-previous.json" \
  || echo "none in the container"
PREVIOUS=$(shasum -a 256 /tmp/turn-replay-previous.json 2>/dev/null | cut -d' ' -f1 || true)

step "launch the run"
echo "Nobody has to hold the phone: this leg neither plays nor listens."
nohup xcrun devicectl device process launch --console --device "$DEVICE" "$DEV_ID" \
  > "$RUNLOG.console" 2>&1 </dev/null &
CONSOLE_PID=$!
echo "started at $(date +%H:%M:%S); waiting ${WAIT}s"
SLICE=10
for _ in $(seq 1 $(((WAIT + SLICE - 1) / SLICE))); do
  sleep "$SLICE"
  printf '%s last line %ss ago\n' "$(date +%H:%M:%S)" \
    "$(( $(date +%s) - $(stat -f %m "$RUNLOG.app.log" 2>/dev/null || echo 0) ))"
done
kill "$CONSOLE_PID" 2>/dev/null || true

step "fetch"
rm -f "$RESULT"
"$(dirname "$0")/fetch-result.sh" turn-replay.json "$RESULT"

step "verdict"
FRESHNESS=$(shasum -a 256 "$RESULT" 2>/dev/null | cut -d' ' -f1 || true)
if [ -n "$PREVIOUS" ] && [ "$FRESHNESS" = "$PREVIOUS" ]; then
  echo "REFUSING TO READ: $RESULT is byte for byte the file that was already in"
  echo "the container before this run. The app did not write a new one."
  exit 1
fi

set +e
RESULT="$RESULT" python3 - <<'VERDICT'
import json, os, sys

path = os.environ["RESULT"]
d = json.load(open(path))
cases = d.get("cases") or []
print("%s  %d cases, %d differ" % (d.get("timestamp", "?"), len(cases), d.get("failed", -1)))
if d.get("error"):
    print("the run itself failed: %s" % d["error"])

def show(events):
    if events is None:
        return "  (the command failed, nothing came back)"
    if not events:
        return "  (no events)"
    return "\n".join(
        "  #%d %s@%s%s" % (i, e["type"], e["atMs"],
                           "" if e.get("silentMs") is None else " silentMs=%s" % e["silentMs"])
        for i, e in enumerate(events))

for c in cases:
    print("%s %s" % ("ok  " if c["ok"] else "FAIL", c["name"]))

bad = [c for c in cases if not c["ok"]]
for c in bad:
    print("\n--- %s (config %s, %d frames)" % (c["name"], json.dumps(c["config"]), c["frames"]))
    if c.get("error"):
        print("  error: %s" % c["error"])
    for line in c.get("differences", []):
        print("  %s" % line)
    print(" the phone said:")
    print(show(c.get("got")))
    print(" turn-detect.ts said:")
    print(show(c.get("expected")))

ok = d.get("ok") and not bad and not d.get("error")
print("\n%s" % ("SAME on all %d" % len(cases) if ok else "%d of %d DIFFER" % (len(bad), len(cases))))
sys.exit(0 if ok else 1)
VERDICT
VERDICT_STATUS=$?
set -e

step "logs"
pkill -f idevicesyslog 2>/dev/null || true
idevicecrashreport -u "$DEVICE" -k "$HOME/crash" >/dev/null 2>&1 || true
wc -l "$RUNLOG.app.log" "$RUNLOG.console" 2>/dev/null || true

exit "$VERDICT_STATUS"
