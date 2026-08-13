// Content hashing for the sync engine. A data file's identity is its bytes.
//
// mtime is not: the app rewrites files with content identical to what is
// already there (a save that changed nothing, a re-serialisation), which moves
// the mtime and used to register as a local edit — and whichever device
// re-saved last won the whole file, wiping the other device's annotations. A
// hash makes an identical rewrite a non-event.
//
// The recipe lives in platform/app/content-hash.ts, which has no imports of its
// own — the engine's tests must stay clear of the Tauri fs plugin. Data files
// run to ~110 KB and there are ~50 of them, so hashing them for real rather
// than approximating is cheap enough.
export { contentHash as hashBytes } from "../app/content-hash";
