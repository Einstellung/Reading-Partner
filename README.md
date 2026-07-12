# Reading Partner

An AI reading companion. Read PDFs and EPUBs with an AI that follows along — ask about the passage you just highlighted, and let your questions, highlights, and conversations accumulate into structured notes on a reading topic.

Built on the [zotero/reader](https://github.com/zotero/reader) engine (rendering + annotation) with a custom shell: Tauri 2 + React + TypeScript. Design notes (in Chinese) live in `docs/`.

## Status

Early development. Current milestone: core reading works — open a local PDF, page through, zoom, and your reading position is restored on reopen. AI features are not wired in yet.

## Build

Prerequisites: Node 18+ (used by the reader engine build), Bun, Rust stable, and the [Tauri 2 Linux/macOS prerequisites](https://tauri.app/start/prerequisites/). The reader build needs network access (it fetches Zotero locale files).

```sh
git clone --recursive git@github.com:Einstellung/Reading-Partner.git
cd Reading-Partner

# Build the embedded reader engine (zotero/reader, pinned via submodule)
./scripts/build-reader.sh

bun install
bun run tauri dev
```

The shell uses Bun; `vendor/reader` builds with its own upstream npm toolchain (driven by the script above).

## Architecture

- `vendor/reader` — zotero/reader as a git submodule, pinned. Never modified in-tree; a small build-time patch (`patches/reader-view-web.patch`) adds a production `view-web` webpack target that exposes the bare `createView` engine (no built-in chrome).
- `public/reader/` — engine build output plus `reader-host.html`, loaded by the shell in an iframe. All UI around it (toolbar, annotations list, AI) is the shell's.
- `src/` — the shell (React). `src-tauri/` — Tauri 2 app, no custom Rust commands so far.
- `docs/04` — the engine integration contract: callback shapes, navigation API, and known traps.
