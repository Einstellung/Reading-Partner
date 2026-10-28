#!/usr/bin/env bash
# Finger selection on EPUB text in real WebKitGTK, through the column's marks
# layer (flow-marks.ts): a hold, a drag, the blue it paints and the rects it
# reports. Checks docs/pitfall/675 (a paragraph inside a selection is one block)
# and 676 (a finger on a character's right half takes the next one), and the
# word rule for dashes and slashes. Exits non-zero when a check fails.
#
# Never opens a window on the user's display: the view is offscreen, under xvfb.
#   scripts/epub-marks-probe/run.sh [repo-root]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="${1:-$(cd "$here/../.." && pwd)}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
bun build "$root/scripts/epub-marks-probe/entry.ts" --target browser --outfile "$out/rp.js" >/dev/null
result="$(xvfb-run -a python3 -I "$here/runner.py" "$here/probe.html" "$out/rp.js")"
echo "$result"
echo "$result" | python3 -I -c 'import json,sys; t=sys.stdin.read(); r=json.loads(t[t.index("{"):t.rindex("}")+1]); bad=[c["name"] for c in r["checks"] if not c["ok"]]; print("FAILED: " + "; ".join(bad) if bad else "all checks pass"); sys.exit(1 if bad or r.get("error") else 0)'
