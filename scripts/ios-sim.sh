#!/usr/bin/env bash
# Drive the app in an iPad simulator with real touches, and read the webview's
# own account of what happened back out.
#
# Three pieces, none of which can replace the others:
#   - `tauri ios dev` puts the real app in a real WKWebView, served by the vite
#     dev server on this machine (the simulator shares its localhost), so a
#     frontend edit is a page reload rather than a rebuild.
#   - idb sends touches through CoreSimulator's HID layer, so WebKit's own
#     gesture arbitration (touch slop, scroll takeover, pointercancel) runs for
#     real. Synthetic DOM events would skip exactly the part worth testing.
#   - The sim bridge (scripts/sim-bridge.ts, a dev-only vite plugin) evaluates
#     JavaScript inside that webview and returns the value, which is how a
#     gesture becomes a measurement instead of a screenshot to squint at.
#
# Setup this expects (see docs/pitfall/117):
#   brew trust facebook/fb && brew install idb-companion
#   python3 -m venv /tmp/idbvenv && /tmp/idbvenv/bin/pip install fb-idb
#
# Usage:
#   scripts/ios-sim.sh up [device-name]     boot the simulator and start the app
#   scripts/ios-sim.sh down                 stop the dev server and the app
#   scripts/ios-sim.sh eval '<js>'          run JS in the webview, print the value
#   scripts/ios-sim.sh eval -f <file.js>    ... from a file
#   scripts/ios-sim.sh open <path>          navigate the webview (/, /embedpdf-spike.html)
#   scripts/ios-sim.sh reader               open the engine harness on demo.pdf and wait for it
#   scripts/ios-sim.sh shot <out.png>       screenshot
#   scripts/ios-sim.sh tap <x> <y>
#   scripts/ios-sim.sh swipe <x1> <y1> <x2> <y2> [seconds] [px-per-step]
#   scripts/ios-sim.sh pinch out|in [scale]  two real contacts, via XCUITest
#   scripts/ios-sim.sh gesture <name> [args...]   a recorded scenario (below)
#   scripts/ios-sim.sh scenarios            list them
#
# Coordinates are CSS pixels: the iPad's points and the webview's CSS pixels are
# 1:1 here (device pixel ratio 2, screenshots are 2x).
set -euo pipefail

# iPad Pro 11-inch (M5), iOS 26.5. Override with IOS_SIM_UDID.
UDID="${IOS_SIM_UDID:-C1F7689F-18AA-4AD3-A13B-DEA225FEF152}"
DEVICE_NAME="${IOS_SIM_DEVICE:-iPad Pro 11-inch (M5)}"
PORT="${IOS_SIM_PORT:-1420}"
IDB="${IDB:-/tmp/idbvenv/bin/idb}"
BUNDLE_ID="${IOS_SIM_BUNDLE:-com.xinyuan.readingpartner}"
OUT="${IOS_SIM_OUT:-/tmp/ios-sim}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JS="$ROOT/scripts/ios-sim"
DEV_LOG="$OUT/dev.log"
BASE="http://localhost:$PORT"

export PATH="/opt/homebrew/bin:$HOME/.cargo/bin:$HOME/.bun/bin:$PATH"
# The free Personal Team. A simulator build is signed ad-hoc and does not need
# it, but tauri reads it for the device target and complains when it is unset.
export APPLE_DEVELOPMENT_TEAM="${APPLE_DEVELOPMENT_TEAM:-NNXRL2S9SA}"

mkdir -p "$OUT"

die() { echo "ios-sim: $*" >&2; exit 1; }

# --- the bridge ------------------------------------------------------------

# Send JavaScript to the webview and print whatever the page returned. The
# response is {id, ok, value} or {id, ok:false, error}; a non-zero exit means
# the page threw, so a scenario stops at the first broken step.
sim_eval() {
  local body
  body=$(cat)
  local res
  res=$(curl -s --max-time 40 -X POST --data-binary @- "$BASE/__sim/eval" <<<"$body") || die "the dev server is not answering on $PORT (is \`up\` running?)"
  [ -n "$res" ] || die "empty answer from the bridge"
  if ! printf '%s' "$res" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("ok") else 1)'; then
    printf '%s\n' "$res" | python3 -c 'import json,sys; print("page threw:", json.load(sys.stdin).get("error"), file=sys.stderr)'
    return 1
  fi
  printf '%s' "$res" | python3 -c 'import json,sys; v=json.load(sys.stdin)["value"]; print(v if isinstance(v,str) else json.dumps(v))'
}

# Uncaught errors and rejections the page reported since the last read.
sim_logs() { curl -s --max-time 10 "$BASE/__sim/logs"; echo; }

# --- lifecycle -------------------------------------------------------------

cmd_up() {
  [ $# -gt 0 ] && DEVICE_NAME="$1"
  command -v xcrun >/dev/null || die "xcrun not found"
  [ -x "$IDB" ] || echo "ios-sim: warning: no idb at $IDB — touch injection will not work" >&2

  echo "booting $DEVICE_NAME ($UDID)"
  xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || true

  # vite's port is strictPort: a leftover listener makes the next run fail
  # outright rather than pick another port.
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | xargs -r kill -9 || true
  pkill -f "tauri ios dev" 2>/dev/null || true
  sleep 1

  echo "starting tauri ios dev -> $DEV_LOG"
  (
    cd "$ROOT"
    nohup bun run tauri ios dev "$DEVICE_NAME" --no-dev-server-wait >"$DEV_LOG" 2>&1 &
  )

  echo -n "waiting for the app to answer the bridge"
  for _ in $(seq 1 120); do
    if printf 'location.href' | sim_eval >/dev/null 2>&1; then
      echo " — up"
      printf 'location.href' | sim_eval
      return 0
    fi
    echo -n "."
    sleep 5
  done
  echo
  tail -20 "$DEV_LOG" >&2
  die "the app never answered; see $DEV_LOG"
}

cmd_down() {
  pkill -f "tauri ios dev" 2>/dev/null || true
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | xargs -r kill -9 || true
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  echo "stopped (the simulator is left booted; \`xcrun simctl shutdown $UDID\` to close it)"
}

# --- observation -----------------------------------------------------------

cmd_shot() {
  local dest="${1:-$OUT/shot.png}"
  xcrun simctl io "$UDID" screenshot "$dest" >/dev/null 2>&1
  echo "$dest"
}

# --- touch -----------------------------------------------------------------

cmd_tap() { "$IDB" ui tap --udid "$UDID" "$1" "$2"; }

# Two contacts at once. idb's HID channel carries a single contact — two
# concurrent `idb ui swipe` calls collapse into one finger — so anything with a
# second finger goes through a UI-test bundle instead (scripts/ios-sim/
# GestureDriver), which drives the app by bundle id and needs no host app of its
# own. Built once into DerivedData and re-run per gesture.
cmd_pinch() {
  local dir="${1:-out}" scale="${2:-2.0}"
  local proj="$JS/GestureDriver"
  command -v xcodegen >/dev/null || die "xcodegen not found (brew install xcodegen)"
  [ -d "$proj/GestureDriver.xcodeproj" ] || (cd "$proj" && xcodegen generate >/dev/null)
  local dest="platform=iOS Simulator,id=$UDID"
  if [ ! -d "$OUT/xcuitest-built" ]; then
    (cd "$proj" && xcodebuild -project GestureDriver.xcodeproj -scheme GestureDriverUITests \
      -destination "$dest" build-for-testing >"$OUT/xcuitest-build.log" 2>&1) \
      || { tail -20 "$OUT/xcuitest-build.log" >&2; die "could not build the gesture driver"; }
    mkdir -p "$OUT/xcuitest-built"
  fi
  (cd "$proj" && TEST_RUNNER_GESTURE="pinch-$dir" TEST_RUNNER_SCALE="$scale" \
    TEST_RUNNER_TARGET_BUNDLE_ID="$BUNDLE_ID" \
    xcodebuild test-without-building -project GestureDriver.xcodeproj \
    -scheme GestureDriverUITests -destination "$dest" >"$OUT/xcuitest.log" 2>&1) \
    || { grep -E "error:|XCTAssert|failed" "$OUT/xcuitest.log" | head -10 >&2; die "the pinch did not run"; }
  grep -qE "passed \(" "$OUT/xcuitest.log" || { tail -20 "$OUT/xcuitest.log" >&2; die "the pinch did not run"; }
  echo "pinch-$dir scale=$scale"
}

# A drag. The two optional arguments are what make it a measurement rather than
# a swipe: `seconds` sets how fast the finger moves and `px-per-step` how far it
# travels between two injected touch points — and WebKit's decision to keep or
# take the sequence depends on both (docs/pitfall/117).
cmd_swipe() {
  local x1="$1" y1="$2" x2="$3" y2="$4" dur="${5:-0.4}" delta="${6:-4}"
  "$IDB" ui swipe --udid "$UDID" --duration "$dur" --delta "$delta" "$x1" "$y1" "$x2" "$y2"
}

# --- the app ---------------------------------------------------------------

cmd_open() {
  local path="${1:-/}"
  printf 'location.href = %s; "navigating"' "\"$path\"" | sim_eval >/dev/null
  sleep 2
  for _ in $(seq 1 30); do
    if printf 'location.pathname' | sim_eval 2>/dev/null | grep -q .; then break; fi
    sleep 1
  done
  printf 'location.pathname' | sim_eval
}

# The engine harness (embedpdf-spike.html) mounts EmbedPdfView on public/demo.pdf
# with no shell around it, and hands the whole EmbedPdfHandle to window.__spike —
# tool, layout, finger-draw and page are all reachable from the bridge, which is
# what makes the reader's gestures scriptable without a library or a file picker.
cmd_reader() {
  cmd_open /embedpdf-spike.html >/dev/null
  echo -n "waiting for the engine"
  for _ in $(seq 1 60); do
    if printf 'window.__spike && window.__spike.ready ? 1 : 0' | sim_eval 2>/dev/null | grep -q 1; then
      echo " — ready"
      cmd_rec_install >/dev/null
      printf 'JSON.stringify(window.__spike.lastStats)' | sim_eval
      return 0
    fi
    echo -n "."
    sleep 1
  done
  echo
  die "the harness never became ready (see the page log: $0 logs)"
}

cmd_rec_install() { sim_eval <"$JS/recorder.js"; }

# --- scenarios -------------------------------------------------------------

# Everything below follows the same shape: put the reader in a known state,
# start the recorder, send one real drag, stop, print what the page saw. The
# state is set through the engine handle rather than the UI so a scenario cannot
# fail for a reason that has nothing to do with the gesture.

setup() { # setup <layout> <tool> <fingerDraw 0|1> <page>
  printf '(async () => { const h = window.__spike.handle; h.setLayout("%s"); h.setTool("%s"); h.setFingerDraw(%s); h.navigateToPage(%s); await new Promise(r => setTimeout(r, 1200)); return JSON.stringify(window.__spike.lastStats); })()' \
    "$1" "$2" "$3" "$4" | sim_eval
}

record_swipe() { # record_swipe <x1> <y1> <x2> <y2> [dur] [delta]
  # Idempotent: the recorder lives in the page, so any reload drops it.
  cmd_rec_install >/dev/null
  printf 'JSON.stringify(window.__rec.start())' | sim_eval >/dev/null
  cmd_swipe "$@" >/dev/null
  sleep 1
  printf 'JSON.stringify(window.__rec.brief())' | sim_eval
}

scenario_vertical_top() {
  setup vertical pointer false 0 >/dev/null
  # Pull down from the first page: there is nothing above it, so this is the
  # rubber band's top edge.
  record_swipe 417 400 417 900 0.6 4
}

scenario_vertical_bottom() {
  setup vertical pointer false 0 >/dev/null
  # Park on the last page's bottom, then keep pulling up past it. This is the
  # edge docs/pitfall/45 says a content translate cannot reach.
  printf '(async () => { const s = [...document.querySelectorAll("[data-reader-surface] *")].find(e => /(auto|scroll)/.test(getComputedStyle(e).overflowY)); s.scrollTop = s.scrollHeight; await new Promise(r => setTimeout(r, 1500)); s.scrollTop = s.scrollHeight; await new Promise(r => setTimeout(r, 600)); return JSON.stringify({st: s.scrollTop, max: s.scrollHeight - s.clientHeight}); })()' | sim_eval
  record_swipe 417 900 417 400 0.6 4
}

scenario_ink_finger() {
  # The pen tool with finger-draw off: a finger must move the page and leave no
  # stroke behind (docs/pitfall/37, 44).
  setup vertical ink false 3 >/dev/null
  printf 'window.__spike.saves.length = 0; window.__spike.saves.length' | sim_eval >/dev/null
  record_swipe 417 800 417 400 0.5 4
  printf 'JSON.stringify({saves: window.__spike.saves.length, embed: window.__spike.handle._debug.dumpEmbed().length, sel: String(getSelection()).length})' | sim_eval
}

scenario_ink_finger_horizontal() {
  # The horizontal half of the same rule: a sideways drag must commit as a
  # scroll, not leak into the annotation layer.
  setup vertical ink false 3 >/dev/null
  printf 'window.__spike.saves.length = 0; window.__spike.saves.length' | sim_eval >/dev/null
  record_swipe 200 700 700 700 0.5 4
  printf 'JSON.stringify({saves: window.__spike.saves.length, embed: window.__spike.handle._debug.dumpEmbed().length, sel: String(getSelection()).length})' | sim_eval
}

# The reader's own pinch path: two real contacts, the engine's zoom, and the
# invariant docs/pitfall/38 is about — the text layer must not be dragged into a
# selection by the two fingers doing the zooming.
scenario_pinch() { # [out|in] [scale]
  cmd_rec_install >/dev/null
  setup vertical pointer false 0 >/dev/null
  printf 'JSON.stringify({zoomBefore: window.__spike.lastStats.zoom, selBefore: String(getSelection()).length})' | sim_eval
  printf 'JSON.stringify(window.__rec.start())' | sim_eval >/dev/null
  cmd_pinch "${1:-out}" "${2:-2.0}" >/dev/null
  sleep 0.5
  printf '(() => { const r = window.__rec.brief(); const ev = window.__rec.events(); const t = ev.filter(e => e.type.startsWith("touch")); return JSON.stringify({maxTouches: Math.max(...t.map(e => e.n || 0), 0), pointerIds: new Set(ev.filter(e => e.id !== undefined).map(e => e.id)).size, downs: r.counts.pointerdown || 0, ups: r.counts.pointerup || 0, cancels: r.counts.pointercancel || 0, zoomAfter: window.__spike.lastStats.zoom, selChars: r.selectionChars, embed: window.__spike.handle._debug.dumpEmbed().length}); })()' | sim_eval
}

scenario_paged_flip() {
  setup paged pointer false 2 >/dev/null
  record_swipe 700 600 150 600 0.4 4
  printf 'JSON.stringify(window.__spike.lastStats)' | sim_eval
}

# What WebKit itself does with a touch, measured on a plain scroll container
# rather than the reader (whose page boxes are touch-action:none, docs/37).
# Answers the two questions docs/pitfall/70 and 71 left open for iOS: does
# WKWebView send pointercancel when it takes a scroll, and how far has the
# finger already travelled when the page gets its first touchmove.
scenario_webkit_claim() { # [duration] [delta]
  sim_eval <"$JS/claim-probe.js" >/dev/null
  printf 'window.__claim.reset("%s")' "${3:-native}" | sim_eval >/dev/null
  cmd_swipe 417 800 417 300 "${1:-0.6}" "${2:-4}" >/dev/null
  sleep 1
  printf 'JSON.stringify(window.__claim.report())' | sim_eval
}

cmd_gesture() {
  local name="${1:-}"; shift || true
  case "$name" in
    vertical-top) scenario_vertical_top "$@" ;;
    vertical-bottom) scenario_vertical_bottom "$@" ;;
    ink-finger) scenario_ink_finger "$@" ;;
    ink-finger-horizontal) scenario_ink_finger_horizontal "$@" ;;
    paged-flip) scenario_paged_flip "$@" ;;
    webkit-claim) scenario_webkit_claim "$@" ;;
    pinch) scenario_pinch "$@" ;;
    *) die "unknown scenario '$name' (see \`$0 scenarios\`)" ;;
  esac
  cmd_shot "$OUT/$name.png"
}

cmd_scenarios() {
  cat <<'EOF'
vertical-top             pull down at the top of a continuous scroll  (rubber band, pitfall 45)
vertical-bottom          pull up past the bottom of it                (rubber band, pitfall 45)
ink-finger               pen tool, finger drags down                  (routing, pitfalls 37/44)
ink-finger-horizontal    pen tool, finger drags sideways              (routing, pitfall 37)
paged-flip               paged layout, swipe to the next page
webkit-claim [dur] [delta]  WebKit's own touch takeover on a plain scroller (pitfalls 70/71)
pinch [out|in] [scale]   two real contacts pinch-zooming the reader (pitfalls 38/41)
EOF
}

# --- entry -----------------------------------------------------------------

case "${1:-}" in
  up) shift; cmd_up "$@" ;;
  down) cmd_down ;;
  eval)
    shift
    if [ "${1:-}" = "-f" ]; then sim_eval <"$2"; else printf '%s' "$1" | sim_eval; fi ;;
  logs) sim_logs ;;
  open) shift; cmd_open "$@" ;;
  reader) cmd_reader ;;
  rec-install) cmd_rec_install ;;
  shot) shift; cmd_shot "$@" ;;
  tap) shift; cmd_tap "$@" ;;
  swipe) shift; cmd_swipe "$@" ;;
  pinch) shift; cmd_pinch "$@" ;;
  gesture) shift; cmd_gesture "$@" ;;
  scenarios) cmd_scenarios ;;
  *) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
