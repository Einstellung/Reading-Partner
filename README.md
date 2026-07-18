# Reading Partner

An AI reading companion for academic surveys and technical books. It doesn't just chat next to your PDF — it reads the same book you do, prepares lessons from the papers the book cites, remembers what you understood and where you got stuck, and teaches with citations you can click to jump back into the text.

![Reading a survey with the lesson-prep panel open](docs/assets/app-overview.png)

Local-first and backend-free: bring your own API key (Anthropic, OpenAI, DeepSeek, or any OpenAI-compatible endpoint). Books, annotations, notes, memory, and keys never leave your machine.

## Two modes

**Companion mode** — you drive. Mark a passage with the AI pen and it explains it in place, like a video call with the book: the reply opens in a bubble you can expand, and the thread stays anchored to your highlight forever. The AI can turn pages on its own, run full-text search across the books in your topic, and read your existing highlights and notes when the conversation needs them. A button in the top bar opens a book-level thread for questions that belong to no particular passage ("what is this chapter about?").

**Classroom mode** — the AI drives. Toggle it inside any conversation and the AI switches from companion to teacher: the entire survey stays resident in its context, together with lesson notes it prepared for the papers the survey actually leans on.

## Lesson prep

When you open a survey, the AI reads it, picks the 15–20 load-bearing citations, and prepares them in the background:

- Full texts come from arXiv first, then [OpenAlex](https://openalex.org) (no key needed), then Semantic Scholar (optional free API key in Settings avoids the shared rate pool).
- Each paper is digested by an agent loop into a lesson note — short papers in one pass, long ones by turning pages with the same tools you see in chat.
- The prep panel in the sidebar shows every paper's status; you can skip, retry, replan, or add papers by title, arXiv id, or URL.
- Preparation is lazy and chapter-driven: papers cited by the chapter you are reading get prepared first. Everything is resumable across restarts.

![Classroom prep running while reading](docs/assets/classroom-prep.png)

## Citations you can click

The AI cites what it teaches. Page references render as chips — click one and the reader jumps to the page, with the exact quoted sentence flashed as a transient violet highlight so you see precisely what was referenced. Figures render as inline cards cropped from the actual page (vector diagrams included); click to jump, or ask about a figure and the AI will look at the image itself through its vision tool.

![Page citations inline in an explanation](docs/assets/citations.png)

## Memory

When you hang up a conversation, the AI silently distills it: where you are in the book, what you now understand, where you were stuck, what you corrected it about. One fact per file, on your disk, inspectable in the sidebar's Memory tab. The next conversation opens with a snapshot — the AI knows you read to section 4.2, struggled with the KV cache last week, and resolved it. Corrections happen in conversation ("you remembered that wrong") rather than by editing files.

## Feed it links

Paste a URL into the chat — an arXiv or OpenReview PDF, or a web article — and the AI ingests it: downloads, extracts, files it into the prep list, and can discuss it against the survey in the same turn. The survey is static; the field is not.

## Thinking levels

Adaptive reasoning is on by default: low effort for conversation (fast answers, the model thinks only when the question demands it), medium for lesson prep (background work, quality first). Both are adjustable in Settings.

## Install

Prebuilt binaries for Linux, macOS and Windows are on the [releases page](https://github.com/Einstellung/Reading-Partner/releases). They are unsigned: macOS will refuse the first launch until you right-click the app and choose Open, and Windows SmartScreen will warn once.

First run: open Settings, pick a provider, paste your API key. Optionally add a Semantic Scholar API key for lesson prep.

## Build

Prerequisites: Bun, Rust stable, and the [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/).

```sh
git clone git@github.com:Einstellung/Reading-Partner.git
cd Reading-Partner

bun install
bun run wasm   # stage the self-hosted PDFium wasm (from the @embedpdf/pdfium package, offline)
bun run tauri dev
```

`bun test` runs the suite (no network, no AI tokens). An iOS/TestFlight pipeline is prepared in `.github/workflows/ios-testflight.yml`.

## Architecture

- `src/reader-embedpdf/` — the engine adapter: assembles EmbedPDF's headless core + plugins, renders from in-memory bytes, and converts annotations at the boundary (the shell persists its own JSON schema). All UI around it (toolbar, annotations list, AI) is the shell's.
- `public/pdfium/pdfium.wasm` — the PDFium engine binary, self-hosted (gitignored; staged by `bun run wasm` from the npm package, no CDN at build or runtime).
- `src/ai/` — provider streaming and the agent tool loop. `src/prep/` — the lesson-prep pipeline. `src/memory/` — the per-topic memory store. `src/figures/` — figure extraction and rendering. `src-tauri/` — Tauri 2 app.
- Design consensus documents (in Chinese) live in `docs/`; hard-won engine/Tauri surprises are indexed in `docs/pitfall/`.

## Status

Early development, PDF only, moving fast. The screenshots above come from real reading sessions and may lag behind the current interface.

## License

[AGPL-3.0](./LICENSE). The PDF engine is [EmbedPDF](https://github.com/embedpdf/embed-pdf-viewer) (MIT), which renders through [PDFium](https://pdfium.googlesource.com/pdfium/) compiled to WebAssembly (Apache-2.0).
