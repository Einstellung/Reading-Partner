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
 * Resolves once the sheet is on screen, not once the reader has chosen
 * something: what they picked, and whether they dismissed it, is not reported
 * back by iOS and is not guessed here. Rejects with a sentence when there is no
 * native half, so a caller that skipped the probe still has something to show.
 */
export async function openIn(path: string): Promise<void> {
  await invoke("plugin:openin|open_in", { path });
}

/**
 * The absolute path of the library's copy of a book, which is what `openIn`
 * takes. Built here rather than at the call site because AppData is this
 * directory's business and `libraryBookPath` returns a path relative to it.
 */
export async function libraryFilePath(bookId: string, format?: BookFormat): Promise<string> {
  return join(await appDataDir(), libraryBookPath(bookId, format));
}
