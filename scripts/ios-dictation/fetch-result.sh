#!/bin/bash
# Pull a smoke verdict out of the app's data container. `devicectl device info
# files` answers with a flat list of relativePath entries, so the file is found
# by name rather than by predicting where Tauri's app_data_dir lands.
#
#   fetch-result.sh [filename] [local destination]
#
# filename defaults to dictation-result.json; the guided and long runs write
# dictation-guided.json and dictation-long.json.
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
DEVICE=00008140-000C31641EEB001C
APP=com.xinyuan.readingpartner
NAME=${1:-dictation-result.json}
OUT=${2:-/tmp/$NAME}

xcrun devicectl device info files \
  --device "$DEVICE" \
  --domain-type appDataContainer \
  --domain-identifier "$APP" \
  --username mobile \
  --json-output /tmp/container-listing.json > /dev/null 2>&1 || true

REL=$(NAME="$NAME" python3 -c '
import json, os
name = os.environ["NAME"]
d = json.load(open("/tmp/container-listing.json"))
hits = [f["relativePath"] for f in d["result"]["files"]
        if f["relativePath"].endswith(name)]
print(hits[0] if hits else "")
')

if [ -z "$REL" ]; then
  echo "$NAME is not in the container yet"
  python3 -c '
import json
d = json.load(open("/tmp/container-listing.json"))
for f in d["result"]["files"]:
    print(" ", f["relativePath"])
'
  exit 1
fi

echo "container path: $REL"
rm -f "$OUT"
xcrun devicectl device copy from \
  --device "$DEVICE" \
  --domain-type appDataContainer \
  --domain-identifier "$APP" \
  --user mobile \
  --source "$REL" \
  --destination "$OUT" 2>&1 | tail -2
wc -c "$OUT"
