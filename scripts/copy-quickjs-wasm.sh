#!/usr/bin/env bash
# Self-host the QuickJS wasm run_code runs programs in (docs/soul/686). The
# binary ships inside the quickjs-wasi npm package (a dependency of
# @earendil-works/pi-codemode), so this is offline-reproducible after
# `bun install`. The webview fetches it from /quickjs/quickjs.wasm
# (src/legion/codemode/wasm.ts). Run by `bun run wasm`.
set -euo pipefail
cd "$(dirname "$0")/.."
src="node_modules/quickjs-wasi/quickjs.wasm"
dst="public/quickjs/quickjs.wasm"
if [ ! -f "$src" ]; then
  echo "quickjs.wasm not found at $src — run 'bun install' first" >&2
  exit 1
fi
mkdir -p public/quickjs
cp "$src" "$dst"
echo "copied $src -> $dst"
