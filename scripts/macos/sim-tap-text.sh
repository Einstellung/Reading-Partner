#!/bin/bash
# Find a visible clickable element in the simulator's webview by its text and
# real-tap its centre through idb. A shorthand on top of scripts/ios-sim.sh,
# which reads the simulator, port and idb from the environment:
#
#   IOS_SIM_UDID=<udid> IOS_SIM_DEVICE="iPhone 17 Pro" IOS_SIM_PORT=1425 \
#   IDB=$HOME/idbvenv/bin/idb scripts/macos/sim-tap-text.sh "Delete" [nth]
#
# Matches button, a, label, input, li, summary and the usual ARIA roles whose
# text, value or aria-label contains the string; the shortest text wins, `nth`
# picks a later one.
set -euo pipefail
SIM="$(cd "$(dirname "$0")/.." && pwd)/ios-sim.sh"
T="$1"; N="${2:-0}"
JS=$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$T")
R=$("$SIM" eval "(() => { const t = $JS; const els = [...document.querySelectorAll(\"button,a,[role=button],[role=radio],[role=checkbox],[role=tab],[role=switch],label,input,li,summary\")].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && (e.innerText || e.value || e.getAttribute(\"aria-label\") || \"\").trim().includes(t); }); els.sort((a,b) => (a.innerText||\"\").length - (b.innerText||\"\").length); const e = els[$N]; if (!e) return \"none\"; const r = e.getBoundingClientRect(); return Math.round(r.left + r.width/2) + \" \" + Math.round(r.top + r.height/2); })()")
if [ "$R" = "none" ] || [ -z "$R" ]; then echo "not found: $T"; exit 1; fi
# shellcheck disable=SC2086
"$SIM" tap $R && echo "tapped $T at $R"
