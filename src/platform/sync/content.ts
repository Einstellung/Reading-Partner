// Content hashing for the sync engine. A data file's identity is its bytes.
//
// mtime is not: the app rewrites files with content identical to what is
// already there (a save that changed nothing, a re-serialisation), which moves
// the mtime and used to register as a local edit — and whichever device
// re-saved last won the whole file, wiping the other device's annotations. A
// hash makes an identical rewrite a non-event.
//
// Same recipe as the book id in platform/app/library.ts (sha256, hex, first 16
// bytes) but a copy on purpose: that module imports the Tauri fs plugin at
// module scope, and everything the engine's tests import must stay free of it.

// Hex sha256 of the bytes, truncated to 16 bytes (32 hex chars). Data files run
// to ~110 KB and there are ~50 of them, so this is cheap enough to do for real
// rather than approximate.
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 32);
}
