#!/usr/bin/env bash
# run_code in real WebKitGTK (docs/soul/686): builds the app with Vite so the
# worker is the one Vite emits, serves the probe page, the built worker and the
# self-hosted quickjs.wasm over a loopback HTTP server, and loads the page in an
# offscreen view. Exits non-zero when a check fails.
#
# Never opens a window on the user's display: the view is offscreen, under xvfb.
#   scripts/codemode-probe/run.sh [repo-root]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="${1:-$(cd "$here/../.." && pwd)}"
out="$(mktemp -d)"
server=""
cleanup() {
  [ -n "$server" ] && kill "$server" 2>/dev/null || true
  rm -rf "$out"
}
trap cleanup EXIT
(cd "$root" && bash scripts/copy-quickjs-wasm.sh >/dev/null && ./node_modules/.bin/vite build --outDir "$out/dist" --emptyOutDir >/dev/null 2>&1)
worker="$(cd "$out/dist/assets" && ls worker-*.js | grep -v engine | head -1)"
mkdir -p "$out/site/quickjs"
cp "$out/dist/assets/$worker" "$out/site/codemode-worker.js"
cp "$out/dist/quickjs/quickjs.wasm" "$out/site/quickjs/quickjs.wasm"
bun build "$here/entry.ts" --target browser --define 'WORKER_URL="/codemode-worker.js"' --outfile "$out/site/probe.js" >/dev/null
printf '<!doctype html><meta charset="utf-8"><script type="module" src="/probe.js"></script>\n' >"$out/site/index.html"
port="$(python3 -I -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
python3 -I -m http.server --bind 127.0.0.1 --directory "$out/site" "$port" >/dev/null 2>&1 &
server=$!
sleep 0.5
result="$(xvfb-run -a python3 -I "$here/runner.py" "http://127.0.0.1:$port/index.html")"
echo "$result"
echo "$result" | python3 -I -c 'import json,sys; t=sys.stdin.read(); r=json.loads(t[t.index("{"):t.rindex("}")+1]); bad=[c["name"] for c in r["checks"] if not c["ok"]]; print("FAILED: " + "; ".join(bad) if bad else "all checks pass"); sys.exit(1 if bad or r.get("error") else 0)'
