#!/bin/bash
# Drive an iPhone/iPad on USB from Linux, no Mac: install CI-built ipas, mount
# the developer disk image, start WebDriverAgent as an XCUITest, forward its
# port, screenshot and tap. Everything runs as the user through
# pymobiledevice3's userspace iOS 17+ tunnel; the only root step is starting
# usbmuxd (`sudo systemctl start usbmuxd`) when it is not running.
#
#   device.sh check                    usbmuxd, device, iOS version, developer mode
#   device.sh fetch [run-id]           download the CI ipas (latest run of the branch by default)
#   device.sh install <ipa>            install, refusing the shipping bundle id
#   device.sh mount                    mount the personalized developer disk image
#   device.sh wda-start                XCUITest-launch WDA, forward device 8100 -> 127.0.0.1:18100
#   device.sh wda-stop                 stop what wda-start started (by recorded PID)
#   device.sh smoke                    /status, screenshot via WDA, one tap on the home screen
#   device.sh launch [bundle-id]       launch an app (default: the .dev build)
#   device.sh shot [out.png]           screenshot without WDA (DVT)
#
# UDID picks the device (default: first on USB). TUNNEL_OPT defaults to
# --userspace; with a root `pymobiledevice3 remote tunneld` running, set
# TUNNEL_OPT="--tunnel $UDID" for the kernel tunnel instead.
set -euo pipefail

PMD3=${PMD3:-$HOME/.local/share/pmd3-venv/bin/pymobiledevice3}
PY=$(dirname "$PMD3")/python
STATE=${STATE:-$HOME/.cache/rp-ios-linux}
WDA_RUNNER=${WDA_RUNNER:-com.xinyuan.wda.xctrunner}
DEV_ID=${DEV_ID:-com.xinyuan.readingpartner.dev}
SHIPPING_ID=com.xinyuan.readingpartner
LOCAL_PORT=${LOCAL_PORT:-18100}
BRANCH=${BRANCH:-exp/linux-ios-loop}
mkdir -p "$STATE"

[ -x "$PMD3" ] || { echo "pymobiledevice3 not found at $PMD3 (python3 -m venv ~/.local/share/pmd3-venv && ~/.local/share/pmd3-venv/bin/pip install pymobiledevice3)"; exit 1; }

udid() {
  if [ -n "${UDID:-}" ]; then echo "$UDID"; return; fi
  "$PMD3" usbmux list --usb --simple 2>/dev/null | "$PY" -I -c '
import json,sys
try: d=json.load(sys.stdin)
except ValueError: d=[]
d=[x if isinstance(x,str) else x.get("UniqueDeviceID","") for x in d]
print(d[0] if d else "")'
}
need_udid() { U=$(udid); [ -n "$U" ] || { echo "no iOS device on USB (lsusb | grep -i apple; is usbmuxd running?)"; exit 1; }; }
TUNNEL_OPT=${TUNNEL_OPT:---userspace}

bundle_id_of() {
  "$PY" -I -c '
import plistlib,sys,zipfile
z=zipfile.ZipFile(sys.argv[1])
p=[n for n in z.namelist() if n.count("/")==2 and n.startswith("Payload/") and n.endswith(".app/Info.plist")]
print(plistlib.loads(z.read(p[0]))["CFBundleIdentifier"])' "$1"
}

case "${1:-}" in
check)
  systemctl is-active --quiet usbmuxd || echo "usbmuxd is not running: sudo systemctl start usbmuxd"
  lsusb | grep -i 'apple' || echo "no Apple device on USB"
  need_udid
  "$PMD3" lockdown info --udid "$U" 2>/dev/null | "$PY" -I -c '
import json,sys; i=json.load(sys.stdin)
print(i.get("DeviceName"), i.get("ProductType"), "iOS", i.get("ProductVersion"), i.get("UniqueDeviceID"))'
  printf 'developer mode: '; "$PMD3" amfi developer-mode-status --udid "$U" 2>&1 | tail -1
  ;;
fetch)
  RUN=${2:-$(gh run list --branch "$BRANCH" --workflow ios-linux-loop.yml --status success --limit 1 --json databaseId --jq '.[0].databaseId')}
  [ -n "$RUN" ] || { echo "no successful run on $BRANCH"; exit 1; }
  rm -rf "$STATE/ipa"; mkdir -p "$STATE/ipa"
  gh run download "$RUN" -D "$STATE/ipa"
  find "$STATE/ipa" -name '*.ipa'
  ;;
install)
  IPA=${2:?ipa path}
  BID=$(bundle_id_of "$IPA")
  echo "bundle id: $BID"
  [ "$BID" != "$SHIPPING_ID" ] || { echo "REFUSING: $IPA is the shipping app; installing it replaces the TestFlight build"; exit 1; }
  need_udid
  "$PMD3" apps install --udid "$U" "$IPA"
  ;;
mount)
  need_udid
  "$PMD3" mounter auto-mount $TUNNEL_OPT --udid "$U"
  ;;
wda-start)
  need_udid
  "$PMD3" developer dvt xcuitest "$WDA_RUNNER" $TUNNEL_OPT --udid "$U" > "$STATE/xcuitest.log" 2>&1 &
  echo $! > "$STATE/xcuitest.pid"
  "$PMD3" usbmux forward --udid "$U" "$LOCAL_PORT" 8100 > "$STATE/forward.log" 2>&1 &
  echo $! > "$STATE/forward.pid"
  for i in $(seq 1 60); do
    if curl -sf --max-time 2 "http://127.0.0.1:$LOCAL_PORT/status" > "$STATE/status.json"; then
      echo "WDA up on 127.0.0.1:$LOCAL_PORT after ${i}x2s"; cat "$STATE/status.json"; echo; exit 0
    fi
    kill -0 "$(cat "$STATE/xcuitest.pid")" 2>/dev/null || { echo "xcuitest exited:"; tail -30 "$STATE/xcuitest.log"; exit 1; }
    sleep 2
  done
  echo "WDA did not answer in 120s"; tail -30 "$STATE/xcuitest.log"; exit 1
  ;;
wda-stop)
  for f in forward xcuitest; do
    [ -f "$STATE/$f.pid" ] && kill "$(cat "$STATE/$f.pid")" 2>/dev/null && echo "stopped $f" || true
    rm -f "$STATE/$f.pid"
  done
  ;;
smoke)
  B="http://127.0.0.1:$LOCAL_PORT"
  curl -sf "$B/status" | "$PY" -I -c 'import json,sys; s=json.load(sys.stdin)["value"]; print("ready:", s.get("ready"), "ios:", s.get("os",{}).get("version"), "ip:", s.get("ios",{}).get("ip"))'
  OUT=${2:-$STATE/wda-shot.png}
  curl -sf "$B/screenshot" | "$PY" -I -c 'import base64,json,sys; open(sys.argv[1],"wb").write(base64.b64decode(json.load(sys.stdin)["value"]))' "$OUT"
  echo "screenshot: $OUT"
  curl -sf -X POST "$B/wda/homescreen" > /dev/null
  SID=$(curl -sf -X POST -H 'Content-Type: application/json' -d '{"capabilities":{"alwaysMatch":{}}}' "$B/session" | "$PY" -I -c 'import json,sys; print(json.load(sys.stdin)["value"]["sessionId"])')
  # One tap in the middle of the home screen's lower half: on an empty spot it
  # does nothing, on an icon it opens that app. Either way the tap is visible.
  curl -sf -X POST -H 'Content-Type: application/json' "$B/session/$SID/actions" -d '{"actions":[{"type":"pointer","id":"f1","parameters":{"pointerType":"touch"},"actions":[{"type":"pointerMove","duration":0,"x":200,"y":600},{"type":"pointerDown"},{"type":"pause","duration":80},{"type":"pointerUp"}]}]}' > /dev/null && echo "tap sent (session $SID)"
  curl -sf -X DELETE "$B/session/$SID" > /dev/null || true
  ;;
launch)
  need_udid
  "$PMD3" developer dvt launch $TUNNEL_OPT --udid "$U" "${2:-$DEV_ID}"
  ;;
shot)
  need_udid
  "$PMD3" developer dvt screenshot $TUNNEL_OPT --udid "$U" "${2:-$STATE/shot.png}"
  ;;
*)
  sed -n '2,24p' "$0"; exit 1
  ;;
esac
