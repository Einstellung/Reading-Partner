// The content hash both identity schemes are built on, kept on its own so it
// has no dependencies at all.
//
// Two callers with different jobs share the recipe. platform/app/library.ts
// turns a PDF's bytes into the book id, so a book's reading position, marks and
// AI threads follow its content across a move, a rename and a device (docs/13).
// platform/sync/content.ts hashes a data file so that a rewrite with identical
// bytes — a save that changed nothing, a re-serialisation — is a non-event
// rather than a local edit that wins the whole file.
//
// The two hashes are never compared to each other, so this file exists to stop
// the same eight lines being written twice, not to hold them in step. What it
// must keep is its emptiness: platform/sync's tests load their half of the
// engine without the Tauri fs plugin, and library.ts imports that plugin at
// module scope, so the hash cannot live there.

// sha256 of the bytes, hex, truncated to the first 16 bytes (32 hex chars). The
// full digest is 32 bytes; 16 keeps a filename friendly while collision odds
// stay negligible at personal-library scale (birthday bound ~2^64). Books can be
// hundreds of MB, but the bytes are already in memory at open time (the reader
// is handed a buffer), so hashing in the webview needs no extra read and no Rust
// round-trip.
export async function contentHash(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", view as BufferSource);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 32);
}
