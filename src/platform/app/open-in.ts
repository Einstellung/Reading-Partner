// Open in…: hand one file to the system share sheet and let the reader pick
// the app that opens it. On a phone the lesson is the only way into a PDF, and
// this is the way out — the reader who wants the printed page gets it in
// whatever reader they already have.
//
// Native half: plugins/openin (Swift UIActivityViewController on iOS, a
// fallback that answers "no" everywhere else). Nothing here knows about UIKit;
// the one thing this module adds is that the probe never throws, because its
// answer decides whether a control is drawn at all and a thrown probe would
// take the screen with it.

import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";

import { isTauri } from "./host";
import { libraryBookPath, type BookFormat } from "./library";

/**
 * Whether this host can hand a file to another app. False off iOS, false in the
 * browser dev server, and false when the probe itself fails — the caller's
 * question is whether to draw the control, and there is no third answer to it.
 */
export async function openInAvailable(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return (await invoke<boolean>("plugin:openin|is_available")) === true;
  } catch {
    return false;
  }
}

/**
 * Show the share sheet for one file. `path` is absolute — see
 * `libraryFilePath` for the library's copy of a book.
 *
 * `name` is the file name the reader should see, extension included, for when
 * the name on disk is not one: the library stores a book under its content
 * hash, and without this the file arrives in the other app called by 64 hex
 * characters. Build it with `shareFileName`. The native half copies the file
 * under that name for the duration of the sheet; omitted, the file goes over
 * where it lies.
 *
 * Resolves once the sheet is on screen, not once the reader has chosen
 * something: what they picked, and whether they dismissed it, is not reported
 * back by iOS and is not guessed here. Rejects with a sentence when there is no
 * native half, so a caller that skipped the probe still has something to show.
 */
export async function openIn(path: string, name?: string): Promise<void> {
  await invoke("plugin:openin|open_in", name ? { path, name } : { path });
}

// A name has to survive being made into a path component and then written to
// disk. 200 bytes leaves room under the 255 a filesystem name gets, and titles
// that long are already unreadable in a share sheet.
const NAME_MAX_BYTES = 200;

/**
 * `title` as a file name carrying `extension` (given without the dot): what the
 * reader calls the book, made safe to write and long enough to recognise.
 * Separators and control characters become "-", leading dots go, and the stem
 * is cut on a character boundary so name and extension together fit in
 * NAME_MAX_BYTES. Returns "" when nothing usable is left — pass no name then
 * and the file keeps the one it has on disk.
 */
export function shareFileName(title: string, extension: string): string {
  const stem = title
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[/\\:]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .trim()
    // A book added from a file is often titled with the file's own name.
    .replace(new RegExp(`\\.${extension}$`, "i"), "")
    .trim();
  if (!stem) return "";
  const suffix = extension ? `.${extension}` : "";
  const bytes = new TextEncoder();
  let budget = NAME_MAX_BYTES - bytes.encode(suffix).length;
  let cut = "";
  for (const ch of stem) {
    const n = bytes.encode(ch).length;
    if (n > budget) break;
    budget -= n;
    cut += ch;
  }
  const head = cut.trimEnd();
  return head ? head + suffix : "";
}

/**
 * The absolute path of the library's copy of a book, which is what `openIn`
 * takes. Built here rather than at the call site because AppData is this
 * directory's business and `libraryBookPath` returns a path relative to it.
 */
export async function libraryFilePath(bookId: string, format?: BookFormat): Promise<string> {
  return join(await appDataDir(), libraryBookPath(bookId, format));
}
