// Durable data-file access. Every JSON/markdown store writes through
// writeTextAtomic (temp + fsync + rename in Rust, src-tauri/src/atomic_fs.rs)
// rather than the fs plugin's truncate-in-place writeTextFile, so a process
// death mid-write cannot leave a half file behind.
//
// The other half of the same problem is on the read side: most loaders treat an
// unparseable file as "empty" and the next save then makes that permanent. For
// data the app cannot rebuild (the shelf, settings, credentials) readGuardedJson
// moves the bad file aside first, so the fallback is never destructive.
//
// Binary blobs (library PDFs, pasted images) keep using the fs plugin: they are
// content-addressed and re-derivable, and passing hundreds of megabytes through
// the IPC as a JSON number array is not viable (pitfall 29).

import { invoke } from "@tauri-apps/api/core";
import { BaseDirectory, exists, readTextFile } from "@tauri-apps/plugin-fs";

/** Replace an AppData-relative text file atomically. Parent dirs are created. */
export function writeTextAtomic(path: string, contents: string): Promise<void> {
  return invoke("write_text_file_atomic", { path, contents });
}

/**
 * Move an unparseable AppData-relative file aside as `<name>.corrupt-<unix-ms>`.
 * Resolves to the new name, or null when there was nothing to move.
 */
export function quarantineFile(path: string): Promise<string | null> {
  return invoke<string | null>("quarantine_file", { path });
}

export interface CorruptFileReport {
  /** The AppData-relative file that could not be read. */
  file: string;
  /** Where the bad copy was moved, or null when it could not be moved aside. */
  savedAs: string | null;
}

let onCorrupt: (report: CorruptFileReport) => void = () => {};

/** Install the handler that surfaces a quarantined file to the user (App.tsx). */
export function onCorruptFile(handler: (report: CorruptFileReport) => void): void {
  onCorrupt = handler;
}

export type GuardedRead<T> =
  // No file yet: the normal first-run case.
  | { status: "missing" }
  | { status: "ok"; value: T }
  // Unreadable. `savedAs` is the quarantine copy; null means the bytes are still
  // in place (an IO error, not bad content) and a caller must not overwrite them.
  | { status: "corrupt"; savedAs: string | null };

/**
 * Read a JSON file whose contents cannot be rebuilt from anything else.
 * `validate` returns null for content that parses but has the wrong shape,
 * which counts as corrupt. Bad content is quarantined before returning, so the
 * caller's fallback can never be the only thing left on disk. A read that fails
 * for IO reasons is reported without quarantining — nothing is known to be
 * wrong with the file itself.
 */
export async function readGuardedJson<T>(
  file: string,
  validate: (raw: unknown) => T | null,
): Promise<GuardedRead<T>> {
  let text: string;
  try {
    if (!(await exists(file, { baseDir: BaseDirectory.AppData }))) return { status: "missing" };
    text = await readTextFile(file, { baseDir: BaseDirectory.AppData });
  } catch (e) {
    console.error(`failed to read ${file}`, e);
    onCorrupt({ file, savedAs: null });
    return { status: "corrupt", savedAs: null };
  }
  try {
    const value = validate(JSON.parse(text) as unknown);
    if (value !== null) return { status: "ok", value };
  } catch (e) {
    console.error(`failed to parse ${file}`, e);
  }
  let savedAs: string | null = null;
  try {
    savedAs = await quarantineFile(file);
  } catch (e) {
    console.error(`failed to quarantine ${file}`, e);
  }
  onCorrupt({ file, savedAs });
  return { status: "corrupt", savedAs };
}
