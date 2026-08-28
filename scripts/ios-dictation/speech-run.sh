#!/bin/bash
# Build the unattended playback probe, put it on the phone, push the fixture and
# let it run (docs/33, M-voice-2).
#
#   speech-run.sh [speech|speech-live] [seconds to wait] [fixture dir]
#
# `speech` plays the fixture: the control, and no network in it. `speech-live`
# runs those legs and then one more that synthesises the same twelve sentences
# through the vendor and speaks them, which is the only run that exercises the
# whole line at once. That leg needs a key, and the way it gets one is the
# environment of the launched process — devicectl forwards anything the caller
# prefixes with DEVICECTL_CHILD_ — so nothing is written to the phone's disk and
# nothing is baked into the build:
#
#   MIMO_API_KEY=… ~/Reading-Partner/scripts/ios-dictation/speech-run.sh speech-live
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
# The paid team signs in the cloud: ~/.asc-env carries the App Store Connect
# key that xcodebuild is handed through -allowProvisioningUpdates, so the
# certificate and the profile are made on demand and nothing has to be added to
# Xcode. The bundle identifier is the real one, which is what the device is
# provisioned for.
[ -f "$HOME/.asc-env" ] && . "$HOME/.asc-env"
TEAM=${APPLE_DEVELOPMENT_TEAM:?APPLE_DEVELOPMENT_TEAM is unset; see ~/.asc-env}
DEV_ID=com.xinyuan.readingpartner.dev
DEV_NAME="Reading Partner"
DEVICE=00008140-000C31641EEB001C
MODE=${1:-speech}
# Which half to run. The build needs no phone and can happen while it is in the
# user's pocket; only the device half needs it unlocked, and that is the half
# somebody has to stand by for. `all` is both, which is what it used to be.
PHASE=${PHASE:-all}
# Wipe the container before installing. The .dev identifier has been in use
# since the Personal Team days and its container still carries state from runs
# that no longer exist; a run that ends with nothing on disk should not have to
# wonder about that.
FRESH=${FRESH:-0}
# Where the device console and the two syslog streams go. Named per run so that
# an earlier round's logs are never overwritten.
RUNLOG=${RUNLOG:-$HOME/rp-run-$(date +%m%d-%H%M%S)}
# 75 s of fixture twice, 81 s of it once, two echo legs of 39 s each and the
# gaps between them come to about 330 s. The live leg adds a turn of its own:
# twelve sentences synthesised one at a time and then spoken end to end.
WAIT=${2:-$([ "$MODE" = speech-live ] && echo 640 || echo 480)}
FIXTURE=${3:-$HOME/rp-speech-fixture}

if [ "$MODE" = speech-live ] && [ "$PHASE" != build ] && [ -z "${MIMO_API_KEY:-}" ]; then
  echo "MIMO_API_KEY is not set; the live leg has nothing to synthesise with."
  exit 1
fi

cd "$REPO"
step() { printf '\n=== %s ===\n' "$1"; }
IPA_AT="$REPO/src-tauri/gen/apple/build/arm64/Reading Partner.ipa"

# The key reaches the app only here, and only on the run that uses it. The first
# launch below is just to make the data directory.
launch() {
  if [ -n "${MIMO_API_KEY:-}" ]; then
    DEVICECTL_CHILD_MIMO_API_KEY="$MIMO_API_KEY" \
      xcrun devicectl device process launch --device "$DEVICE" "$DEV_ID" 2>&1 | tail -1
  else
    xcrun devicectl device process launch --device "$DEVICE" "$DEV_ID" 2>&1 | tail -1
  fi
}

if [ "$PHASE" != device ]; then

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
  # `init` writes tauri.conf.json's identifier, which is the shipping one. The
  # bench must not install over the build the phone got from TestFlight, so the
  # generated project — which is ignored, and rewritten from scratch above — is
  # pointed at a bundle id of its own. Registered under the same paid team, so
  # the same App Store Connect key still signs it.
  sed -i '' "s/^\( *PRODUCT_BUNDLE_IDENTIFIER: \).*/\1$DEV_ID/" src-tauri/gen/apple/project.yml
  # And in the Xcode project xcodegen already made from it, because whether the
  # build regenerates that from the yml is tauri's business, not ours.
  find src-tauri/gen/apple -name project.pbxproj -exec \
    sed -i '' "s/PRODUCT_BUNDLE_IDENTIFIER = [^;]*;/PRODUCT_BUNDLE_IDENTIFIER = $DEV_ID;/g" {} +
fi
grep -h "PRODUCT_BUNDLE_IDENTIFIER" src-tauri/gen/apple/project.yml | sort -u
rm -rf src-tauri/gen/apple/build

step "build (VITE_SMOKE=$MODE)"
sudo -A launchctl asuser "$GUI_UID" sudo -u "$GUI_USER" \
  /bin/bash -lc "cd '$REPO' && export PATH='$PATH' APPLE_DEVELOPMENT_TEAM=$TEAM \
    APPLE_API_KEY=$APPLE_API_KEY APPLE_API_ISSUER=$APPLE_API_ISSUER \
    APPLE_API_KEY_PATH=$APPLE_API_KEY_PATH VITE_SMOKE=$MODE && \
    bun run tauri ios build --debug --target aarch64 --export-method debugging" 2>&1 | tail -5

fi  # end of the build half

# An explicit path when there is more than one build in play: the device half
# and the build half can be minutes and another build apart, and the tree only
# ever holds the last one.
IPA=${IPA_PATH:-$(find src-tauri/gen/apple/build -name '*.ipa' -type f | head -1)}
echo "ipa: $IPA"
[ -n "$IPA" ] || { echo "no .ipa produced"; exit 1; }
ls -l "$IPA"

if [ "$PHASE" = build ]; then
  echo "build phase done; run again with PHASE=device once the phone is unlocked"
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
# Two device runs ended with no result file, no crash report and no process, and
# nothing on either side could say why. These three streams are what makes the
# next one readable, and they are started before the app is touched:
#
#   .app.log  everything our own process logs, which is where RP-SPEECH and
#             RP-DICT come out.
#   .sys.log  everything anybody logs about our bundle identifier, which is
#             where runningboardd says it took the app away.
#   .console  the launched process's own stdout and stderr, and the moment it
#             exits, because --console waits for that.
#
# Filtered at the relay in both cases: unfiltered, the device writes half a
# megabyte a second and idevicesyslog silently drops what it cannot keep up
# with (docs/pitfall/163).
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

step "push the fixture"
"$(dirname "$0")/push-fixture.sh" "$FIXTURE"

step "launch the run"
# Attached this time. `--console` waits for the app to exit, so the log's last
# line and its mtime are the answer to "when did it go away", which nothing in
# the previous two rounds could give.
if [ -n "${MIMO_API_KEY:-}" ]; then
  DEVICECTL_CHILD_MIMO_API_KEY="$MIMO_API_KEY" \
    nohup xcrun devicectl device process launch --console --device "$DEVICE" "$DEV_ID" \
    > "$RUNLOG.console" 2>&1 </dev/null &
else
  nohup xcrun devicectl device process launch --console --device "$DEVICE" "$DEV_ID" \
    > "$RUNLOG.console" 2>&1 </dev/null &
fi
CONSOLE_PID=$!
echo "started at $(date +%H:%M:%S); waiting ${WAIT}s"
# Every half minute, whether the process is still there. A run that dies at
# 40 s and a run that dies at 400 s look the same in the container afterwards.
for _ in $(seq 1 $((WAIT / 30))); do
  sleep 30
  if xcrun devicectl device info processes --device "$DEVICE" 2>/dev/null \
     | grep -q "$DEV_NAME.app"; then
    printf '%s alive\n' "$(date +%H:%M:%S)"
  else
    printf '%s GONE\n' "$(date +%H:%M:%S)"
  fi
done
kill "$CONSOLE_PID" 2>/dev/null || true

step "fetch"
"$(dirname "$0")/fetch-result.sh" speech-result.json /tmp/speech-result.json
for label in trimmed-burst trimmed-measured raw-burst live; do
  "$(dirname "$0")/fetch-result.sh" "$label.pcm" "/tmp/$label.pcm" || true
done

step "logs"
pkill -f idevicesyslog 2>/dev/null || true
idevicecrashreport -u "$DEVICE" -k "$HOME/crash" >/dev/null 2>&1 || true
wc -l "$RUNLOG.app.log" "$RUNLOG.sys.log" "$RUNLOG.console" 2>/dev/null || true
