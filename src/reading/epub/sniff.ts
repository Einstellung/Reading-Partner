// Is this file an EPUB? An EPUB is a zip whose first entry is an uncompressed
// "mimetype" holding exactly "application/epub+zip".
//
// The order is not relied on. The spec requires that entry to be first and
// stored, and most producers obey, but a book repacked by an ordinary zip tool
// is still the book — so the central directory is walked and the entry looked up
// by name. The zip magic is checked first only because it is free and rules out
// every PDF without inflating anything.

import { openZip } from "./zip";

const MIMETYPE_ENTRY = "mimetype";
const EPUB_MIMETYPE = "application/epub+zip";

/** "PK\x03\x04": a local file header, so the bytes are at least a zip. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

export function isEpub(bytes: Uint8Array): boolean {
  if (!looksLikeZip(bytes)) return false;
  try {
    const mimetype = openZip(bytes).text(MIMETYPE_ENTRY);
    return mimetype !== null && mimetype.trim() === EPUB_MIMETYPE;
  } catch {
    // Not a readable zip after all. Whatever it is, it is not an EPUB.
    return false;
  }
}
