# Reading Partner

An AI reading companion. Read PDFs and EPUBs with an AI that follows along — ask about the passage you just highlighted, and let your questions, highlights, and conversations accumulate into structured notes on a reading topic.

Built on the [EmbedPDF](https://github.com/embedpdf/embed-pdf-viewer) engine (PDFium-in-WebAssembly rendering + annotation) with a custom shell: Tauri 2 + React + TypeScript. Design notes (in Chinese) live in `docs/`.

## Status

Early development, PDF only. Reading works — topics and a booklist, highlights and underlines, a marks list, the document outline, and a restored reading position. The AI works: mark a passage with the AI pen and it explains it right there, and it can read further pages, search the other books in the topic, and look at your notes on them, on its own. Bring your own key (Anthropic, OpenAI, or an OpenAI-compatible endpoint).

## Install

Prebuilt binaries for Linux, macOS and Windows are on the [releases page](https://github.com/Einstellung/Reading-Partner/releases). They are unsigned: macOS will refuse the first launch until you right-click the app and choose Open, and Windows SmartScreen will warn once.

## Build

Prerequisites: Bun, Rust stable, and the [Tauri 2 Linux/macOS prerequisites](https://tauri.app/start/prerequisites/).

```sh
git clone git@github.com:Einstellung/Reading-Partner.git
cd Reading-Partner

bun install
bun run wasm   # stage the self-hosted PDFium wasm (from the @embedpdf/pdfium package, offline)
bun run tauri dev
```

## Architecture

- `src/reader-embedpdf/` — the engine adapter: assembles EmbedPDF's headless core + plugins, renders from in-memory bytes, and converts annotations at the boundary (the shell persists its own JSON schema). All UI around it (toolbar, annotations list, AI) is the shell's.
- `public/pdfium/pdfium.wasm` — the PDFium engine binary, self-hosted (gitignored; staged by `bun run wasm` from the npm package, no CDN at build or runtime).
- `src/` — the shell (React). `src-tauri/` — Tauri 2 app.

## License

[AGPL-3.0](./LICENSE). The PDF engine is [EmbedPDF](https://github.com/embedpdf/embed-pdf-viewer) (MIT), which renders through [PDFium](https://pdfium.googlesource.com/pdfium/) compiled to WebAssembly (Apache-2.0).
