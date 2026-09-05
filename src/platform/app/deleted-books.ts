// The books the reader has deleted, one line per book, at the AppData root.
//
// A file-level delete does not travel over sync: the device that still holds
// annotations-<bookId>.json republishes it and the book comes back (docs/13,
// pitfall 208). So the deletion travels as a record instead — the same shape the
// observation tombstones use (memory/observations/files.ts) — and every device
// that reads this file drops what the book owned. What "owns" means is
// platform/sync/dead-paths.ts; this module is only the file.
//
// JSONL because the records merge identifies a line by the line itself
// (platform/sync/merge/records.ts, "lines" kind): two devices deleting the same
// book on the same day write the same bytes, so the union holds one line. `at`
// is the day the deletion was made and nothing reads it back — it is what makes
// the file legible to someone looking at it later.
//
// Never compacted. A line is about sixty bytes and the count is bounded by how
// many books the reader has ever deleted; dropping one would let a device that
// was offline at the time push the book back.

import { appData } from "./appdata";
import { writeTextAtomic } from "./atomic-fs";

export const DELETED_BOOKS_FILE = "deleted-books.jsonl";

// The day on the device's own clock, not UTC: the reader deleting a book at
// half past midnight in UTC+8 did it today, and the date is only ever read by a
// person.
function localDate(now: number): string {
  const d = new Date(now);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Tolerant on purpose: a line that does not parse, or carries no bookId, is not
// a tombstone and is skipped rather than failing the read. Every caller of this
// is deciding what to delete, and a file it could not read must not be read as
// "nothing was deleted" halfway through.
export function parseDeletedBooks(text: string): Set<string> {
  const ids = new Set<string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    try {
      const value = JSON.parse(line) as { bookId?: unknown };
      if (typeof value?.bookId === "string" && value.bookId !== "") ids.add(value.bookId);
    } catch {
      continue;
    }
  }
  return ids;
}

/**
 * The file's text with one more tombstone in it, or the text unchanged when the
 * book is already tombstoned. Append-only: an existing line is never rewritten,
 * because a rewritten line is a different record to the merge and both versions
 * would survive the union.
 *
 * Pure, so the idempotence can be pinned without a filesystem.
 */
export function appendDeletedBookLine(text: string, bookId: string, at: string): string {
  if (parseDeletedBooks(text).has(bookId)) return text;
  const line = JSON.stringify({ bookId, at });
  if (text === "") return `${line}\n`;
  return text.endsWith("\n") ? `${text}${line}\n` : `${text}\n${line}\n`;
}

async function readText(): Promise<string> {
  try {
    if (!(await appData.exists(DELETED_BOOKS_FILE))) return "";
    return await appData.readText(DELETED_BOOKS_FILE);
  } catch {
    return "";
  }
}

/** Every book id this device knows to be deleted. */
export async function readDeletedBooks(): Promise<Set<string>> {
  return parseDeletedBooks(await readText());
}

/**
 * Record that a book is gone. Asking for a book that is already tombstoned to be
 * gone again writes nothing — it is not an error, and a second line would be a
 * second record for the merge to carry forever.
 */
export async function appendDeletedBook(bookId: string, now?: number): Promise<void> {
  const text = await readText();
  const next = appendDeletedBookLine(text, bookId, localDate(now ?? Date.now()));
  if (next === text) return;
  await writeTextAtomic(DELETED_BOOKS_FILE, next);
}
