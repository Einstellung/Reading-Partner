#!/usr/bin/env bash
#
# Build the zotero/reader "view-web" engine and stage its artifacts into
# public/reader/ for the Tauri shell to load.
#
# Requirements / notes:
#   - Network is required: the reader webpack build downloads locale files from
#     raw.githubusercontent.com at build time (ZoteroLocalePlugin). Offline fails.
#   - Node's OpenSSL legacy provider is required (older webpack crypto usage):
#     every npm/webpack invocation below sets NODE_OPTIONS=--openssl-legacy-provider.
#   - Idempotent: safe to re-run. It inits the submodule only if missing, applies
#     the view-web patch only if not already applied, reuses an existing mobile
#     pdf.js build, and overwrites public/reader/ products in place (keeping
#     reader-host.html, which is tracked and not a build product).
#
# Usage: scripts/build-reader.sh   (from anywhere; paths are resolved absolutely)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
READER="$ROOT/vendor/reader"
PATCH="$ROOT/patches/reader-view-web.patch"
OUT="$ROOT/public/reader"
export NODE_OPTIONS=--openssl-legacy-provider

echo "==> [1/5] Ensure reader submodule (shallow)"
if [ ! -e "$READER/package.json" ]; then
	git -C "$ROOT" submodule update --init --recursive --depth 1
else
	echo "    already checked out, skipping init"
fi

echo "==> [2/5] Apply view-web patch (idempotent)"
if git -C "$READER" apply --reverse --check "$PATCH" >/dev/null 2>&1; then
	echo "    patch already applied, skipping"
elif git -C "$READER" apply --check "$PATCH" >/dev/null 2>&1; then
	git -C "$READER" apply "$PATCH"
	echo "    patch applied"
else
	echo "    ERROR: patch neither applies cleanly nor is already applied." >&2
	echo "    Check reader commit (expected 8cb2963) and $PATCH" >&2
	exit 1
fi

echo "==> [3/5] npm install"
( cd "$READER" && npm install --no-audit --no-fund )

echo "==> [4/5] Build mobile pdf.js (if missing) + view-web bundle (minified)"
if [ ! -f "$READER/build/mobile/pdf/web/viewer.html" ]; then
	echo "    building mobile pdf.js (one-time, slow)"
	( cd "$READER" && PDFJS_CONFIG=mobile bash pdfjs/build )
else
	echo "    build/mobile/pdf present, reusing"
fi
( cd "$READER" && npx webpack --config-name view-web )

echo "==> [5/5] Stage artifacts into public/reader/"
mkdir -p "$OUT"
# Clear previous products but keep the tracked host page.
find "$OUT" -mindepth 1 -maxdepth 1 ! -name reader-host.html -exec rm -rf {} +
# Copy the entry bundle, its lazy chunks, css, and pdf assets; drop source maps
# and the stock view.html (the shell uses reader-host.html instead).
( cd "$READER/build/view-web" \
	&& cp view.js view.css "$OUT/" \
	&& cp ./*.view.js "$OUT/" \
	&& cp -r pdf "$OUT/pdf" )

echo "==> Done. Artifacts in $OUT:"
( cd "$OUT" && ls -1 view.js view.css *.view.js && du -sh pdf )
