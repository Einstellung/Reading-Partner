#!/bin/bash
# Helpers for a physical device on USB, through pymobiledevice3's userspace
# tunnel (no root, no tunneld). Written for the Mac when the iPad was newer than
# Xcode and devicectl could not see it (docs/pitfall/521); the same commands run
# on Linux. Only ever touches the .dev bundle.
#
#   UDID=<udid> scripts/macos/device.sh <command>
#
#   launch               launch the .dev app, print and record its PID
#   kill <pid>           SIGKILL a PID this script recorded (never anything else)
#   procs                running processes matching "reading"
#   shot <name>          screenshot to $SHOTS/<name>.png
#   seed                 push $SEED/{library.json,topics.json,credentials.json,library/*}
#                        into the app's data directory (kill the app first)
#   ls [rel]             list the data directory
#   pull <rel> <dir>     copy a file out of the data directory
#   rm <rel>             delete a file in the data directory
#   iwdp                 start ios_webkit_debug_proxy on :9222 and list targets
#   js '<expr>'          evaluate in the app's WKWebView (webview-eval.py)
#   ajs '<body>' [secs]  run an async function body there and print its return
#
# js/ajs need an inspectable build and the app in the foreground.
set -euo pipefail
P=${PMD3:-$HOME/pmd3venv/bin/pymobiledevice3}
PY=$(dirname "$P")/python
ID=${DEV_ID:-com.xinyuan.readingpartner.dev}
UDID=${UDID:?set UDID}
DATA="/Library/Application Support/$ID"
SHOTS=${SHOTS:-/tmp/device-shots}
SEED=${SEED:-/tmp/device-seed}
PIDS=/tmp/device-pids
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$SHOTS"
case "${1:-}" in
  launch)
    out=$("$P" developer dvt launch --userspace --udid "$UDID" "$ID" 2>&1); echo "$out" | tail -1
    pid=$(echo "$out" | grep -oE '[0-9]+' | tail -1); echo "$pid" >> "$PIDS"; echo "pid=$pid";;
  kill)
    grep -qx "$2" "$PIDS" 2>/dev/null || { echo "refusing: $2 was not launched by this script"; exit 1; }
    "$P" developer dvt kill --userspace --udid "$UDID" "$2" 2>&1 | tail -1; echo "killed $2";;
  procs) "$P" developer dvt proclist --userspace --udid "$UDID" 2>/dev/null | grep -i reading || true;;
  shot) "$P" developer dvt screenshot --userspace --udid "$UDID" "$SHOTS/$2.png" >/dev/null 2>&1 && echo "$SHOTS/$2.png";;
  seed)
    {
      echo "mkdir \"$DATA\""; echo "mkdir \"$DATA/library\""
      for f in library.json topics.json credentials.json; do [ -f "$SEED/$f" ] && echo "push $SEED/$f \"$DATA/$f\""; done
      for f in "$SEED"/library/*; do [ -e "$f" ] && echo "push $f \"$DATA/library/$(basename "$f")\""; done
      echo "ls \"$DATA\""
    } | "$P" apps afc --udid "$UDID" "$ID" 2>&1 | tail -15;;
  ls)   echo "ls \"$DATA/${2:-}\"" | "$P" apps afc --udid "$UDID" "$ID" 2>&1 | tail -40;;
  pull) mkdir -p "$3"; echo "pull \"$DATA/$2\" \"$3\"" | "$P" apps afc --udid "$UDID" "$ID" 2>&1 | tail -3;;
  rm)   echo "rm \"$DATA/$2\"" | "$P" apps afc --udid "$UDID" "$ID" 2>&1 | tail -3;;
  iwdp)
    if ! lsof -nP -iTCP:9222 -sTCP:LISTEN >/dev/null 2>&1; then
      # setsid (Linux; macOS has none) and </dev/null keep the proxy alive
      # after this shell exits.
      S=$(command -v setsid || true)
      $S nohup ios_webkit_debug_proxy -c "$UDID:9222" > /tmp/iwdp.log 2>&1 < /dev/null &
      echo $! > /tmp/iwdp.pid; sleep 2
    fi
    curl -s http://127.0.0.1:9222/json;;
  js)  "$PY" "$HERE/webview-eval.py" eval "$2";;
  ajs) "$PY" "$HERE/webview-eval.py" aeval "$2" "${3:-60}";;
  *) sed -n '2,24p' "$0"; exit 1;;
esac
