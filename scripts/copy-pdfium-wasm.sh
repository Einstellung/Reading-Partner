#!/usr/bin/env bash
# Self-host the PDFium wasm for the EmbedPDF engine (spike). The binary ships
# inside the @embedpdf/pdfium npm package, so this is offline-reproducible after
# `bun install` — no CDN fetch at build or runtime. Run before `bun run dev`
# when VITE_ENGINE=embedpdf.
set -euo pipefail
cd "$(dirname "$0")/.."
src="node_modules/@embedpdf/pdfium/dist/pdfium.wasm"
dst="public/pdfium/pdfium.wasm"
if [ ! -f "$src" ]; then
  echo "pdfium.wasm not found at $src — run 'bun install' first" >&2
  exit 1
fi
mkdir -p public/pdfium
cp "$src" "$dst"
echo "copied $src -> $dst"
