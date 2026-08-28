#!/bin/bash
# Put the pre-synthesised speech fixture into the app's data container, so the
# playback experiments never touch the network.
#
#   push-fixture.sh [local fixture dir]
#
# The container-relative destination is not predicted: Tauri's app data
# directory is derived from the bundle identifier and the listing is the only
# thing that knows where it landed. The app has to have been launched once so
# that the directory exists — `speech/` is created by src/smoke/speech-probe.ts
# on its way in, and `smoke/` by the dictation harness.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
DEVICE=00008140-000C31641EEB001C
APP=com.xinyuan.readingpartner
SRC=${1:-$HOME/rp-speech-fixture}

[ -f "$SRC/manifest.json" ] || { echo "no manifest.json in $SRC"; exit 1; }

xcrun devicectl device info files \
  --device "$DEVICE" \
  --domain-type appDataContainer \
  --domain-identifier "$APP" \
  --username mobile \
  --json-output /tmp/container-listing.json > /dev/null

# The app data directory is whatever holds the harness's own output directory.
PREFIX=$(python3 -c '
import json, posixpath
d = json.load(open("/tmp/container-listing.json"))
for f in d["result"]["files"]:
    p = f["relativePath"]
    for marker in ("/speech/", "/smoke/", "/speech-fixture/"):
        if marker in p:
            print(p[: p.index(marker)])
            raise SystemExit
    for marker in ("speech", "smoke"):
        if p.rstrip("/").endswith("/" + marker):
            print(posixpath.dirname(p.rstrip("/")))
            raise SystemExit
')

if [ -z "$PREFIX" ]; then
  echo "could not find the app data directory in the container listing."
  echo "launch the app once with VITE_SMOKE=speech and try again. listing:"
  python3 -c '
import json
d = json.load(open("/tmp/container-listing.json"))
for f in d["result"]["files"][:60]:
    print(" ", f["relativePath"])
'
  exit 1
fi

DEST="$PREFIX/speech-fixture"
echo "destination: $DEST"

push() {
  xcrun devicectl device copy to \
    --device "$DEVICE" \
    --domain-type appDataContainer \
    --domain-identifier "$APP" \
    --user mobile \
    --source "$1" \
    --destination "$2" > /dev/null
}

push "$SRC/manifest.json" "$DEST/manifest.json"
for kind in trimmed raw; do
  [ -d "$SRC/$kind" ] || continue
  for f in "$SRC/$kind"/*.pcm; do
    push "$f" "$DEST/$kind/$(basename "$f")"
    printf '.'
  done
done
echo
echo "pushed $(ls "$SRC"/trimmed/*.pcm "$SRC"/raw/*.pcm 2>/dev/null | wc -l | tr -d ' ') clips"
