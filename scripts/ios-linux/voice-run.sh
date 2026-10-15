#!/usr/bin/env bash
# Run one silent voice script on the device and print its latency table
# (docs/platform/560, 静默语音测试).
#
#   scripts/ios-linux/voice-run.sh <script> [timeout-seconds]
#   scripts/ios-linux/voice-run.sh pull <run> <device-dir>   # pull a run again
#
# <script> is a name under tests/fixtures/voice-scripts/ without .json. Needs:
# the .dev debug build on the device, the app in the foreground on the info
# page (Lumen showing), and scripts/ios-linux/dev-server.sh running. The run's
# files are pulled into ~/.cache/rp-ios-linux/voice-runs/<run>/.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
HOST=${RP_LAN_HOST:-10.42.0.1}
PORT=${RP_DEV_PORT:-1437}
BASE="http://$HOST:$PORT/__voice-harness"
PMD3=${PMD3:-$HOME/.local/share/pmd3-venv/bin/pymobiledevice3}
UDARGS=()
[[ -n ${UDID:-} ]] && UDARGS=(--udid "$UDID")
BUNDLE=${RP_BUNDLE:-com.xinyuan.readingpartner.dev}
OUT=${RP_VOICE_OUT:-$HOME/.cache/rp-ios-linux/voice-runs}

field() { python3 -c 'import json,sys; d=json.loads(sys.argv[1]) or {}; print(d.get(sys.argv[2],""))' "$1" "$2"; }

pull() {
  local run=$1 dir=$2
  # The device path is absolute; the container-relative part starts at Library/.
  local rel="Library/${dir#*/Library/}"
  local dest="$OUT/$run"
  mkdir -p "$dest/native"
  for f in rust.jsonl native/native.jsonl native/output.wav native/input.wav; do
    "$PMD3" apps pull "${UDARGS[@]}" "$BUNDLE" "$rel/$f" "$dest/$f" >/dev/null || echo "could not pull $f" >&2
  done
  echo "pulled into $dest"
  bun "$REPO/scripts/ios-linux/voice-latency.ts" "$dest"
}

if [[ ${1:-} == pull ]]; then
  pull "${2:?run}" "${3:?device dir}"
  exit 0
fi

SCRIPT=${1:?usage: voice-run.sh <script> [timeout-seconds]}
TIMEOUT=${2:-900}
[[ -f "$REPO/tests/fixtures/voice-scripts/$SCRIPT.json" ]] || { echo "no script $SCRIPT" >&2; exit 2; }

sent=$(curl -fsS -X POST "$BASE/run?script=$SCRIPT&timeout=$TIMEOUT")
id=$(field "$sent" id)
echo "sent $SCRIPT ($id)"

deadline=$((SECONDS + TIMEOUT))
state=""
last=""
st=null
while ((SECONDS < deadline)); do
  st=$(curl -fsS "$BASE/status?id=$id" || echo null)
  state=$(field "$st" state)
  if [[ "$st" != "$last" ]]; then
    echo "$st"
    last=$st
  fi
  [[ $state == done || $state == failed ]] && break
  if [[ $state == sent && $SECONDS -gt 20 && -z ${warned:-} ]]; then
    echo "the app has not picked it up: is it in the foreground, on the dev server, with Lumen showing?" >&2
    warned=1
  fi
  sleep 2
done

# Out of time: ask the app to hang up and end the run, and wait for it to say so,
# so the next run does not start on this one's call. The app has its own deadline
# a little inside ours, so this is the backstop for a run that never answered.
if [[ $state != done && $state != failed ]]; then
  echo "timed out; asking the app to end the run" >&2
  curl -fsS -X POST "$BASE/cancel?id=$id" >/dev/null || true
  grace=$((SECONDS + 40))
  while ((SECONDS < grace)); do
    st=$(curl -fsS "$BASE/status?id=$id" || echo null)
    state=$(field "$st" state)
    [[ $state == done || $state == failed ]] && break
    sleep 2
  done
  echo "$st"
fi

run=$(field "$st" run)
dir=$(field "$st" dir)
if [[ -n $run && -n $dir ]]; then
  pull "$run" "$dir"
fi
[[ $state == done ]] || { echo "run ended as '${state:-timeout}'" >&2; exit 1; }
