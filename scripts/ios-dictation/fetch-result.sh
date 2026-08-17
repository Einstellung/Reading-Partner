#!/bin/bash
# Pull the smoke's verdict out of the app's data container. `devicectl device
# info files` answers with a flat list of relativePath entries, so the file is
# found by name rather than by predicting where Tauri's app_data_dir lands.
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
DEVICE=00008140-000C31641EEB001C
APP=com.xinyuan.readingpartner.dev
OUT=${1:-/tmp/dictation-result.json}

xcrun devicectl device info files \
  --device "$DEVICE" \
  --domain-type appDataContainer \
  --domain-identifier "$APP" \
  --username mobile \
  --json-output /tmp/container-listing.json > /dev/null 2>&1 || true

REL=$(python3 -c '
import json
d = json.load(open("/tmp/container-listing.json"))
hits = [f["relativePath"] for f in d["result"]["files"]
        if f["relativePath"].endswith("dictation-result.json")]
print(hits[0] if hits else "")
')

if [ -z "$REL" ]; then
  echo "dictation-result.json is not in the container yet"
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
