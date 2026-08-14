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
import { reportStoreError } from "./store-errors";

/**
 * The base every data file in the app is addressed from. Passed to the fs
 * plugin as-is, spread when a call needs more (`{ ...APPDATA, recursive: true }`).
 */
export const APPDATA = { baseDir: BaseDirectory.AppData } as const;

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

// Declared in store-errors.ts, beside the sentence the user is shown, and
// re-exported here because this is where a caller of readGuardedJson meets it.
export type { CorruptFileReport } from "./store-errors";

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
    if (!(await exists(file, APPDATA))) return { status: "missing" };
    text = await readTextFile(file, APPDATA);
  } catch (e) {
    console.error(`failed to read ${file}`, e);
    reportStoreError("corrupt-file", { file, savedAs: null });
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
  reportStoreError("corrupt-file", { file, savedAs });
  return { status: "corrupt", savedAs };
}

/**
 * Read a JSON file the app can rebuild or do without — a cache, a pool, what a
 * collector published. A file that is not there yet reads as null and says
 * nothing: that is the first-run case. Everything else — an IO error, bytes
 * that will not parse, a shape `validate` turns down — also reads as null, but
 * warns, so a caller carrying on with nothing is not the only trace left.
 *
 * `validate` returns null for content that parses into the wrong shape. Without
 * it the parsed value is handed back as T unchecked, which is what a caller
 * that re-derives the file anyway wants.
 *
 * For data nothing can rebuild — the shelf, settings, credentials — use
 * readGuardedJson: it moves the bad file aside first, so the fallback the
 * caller saves next cannot become the only copy left.
 */
export async function readJson<T>(
  file: string,
  validate?: (raw: unknown) => T | null,
): Promise<T | null> {
  try {
    if (!(await exists(file, APPDATA))) return null;
    const raw = JSON.parse(await readTextFile(file, APPDATA)) as unknown;
    if (!validate) return raw as T;
    const value = validate(raw);
    if (value === null) console.warn(`unexpected shape in ${file}`);
    return value;
  } catch (e) {
    console.warn(`failed to read ${file}`, e);
    return null;
  }
}

/**
 * Read a text file that cannot be rebuilt from anything else and has no format
 * to fail: markdown the reader wrote themselves. There is no parse step, so
 * nothing here is ever quarantined — whatever bytes are there are the document.
 * The one failure is a read that did not happen, reported as corrupt with a null
 * `savedAs`: the file is still where it was, and the caller must not write over
 * it with whatever it fell back to.
 */
export async function readGuardedText(file: string): Promise<GuardedRead<string>> {
  try {
    if (!(await exists(file, APPDATA))) return { status: "missing" };
    return { status: "ok", value: await readTextFile(file, APPDATA) };
  } catch (e) {
    console.error(`failed to read ${file}`, e);
    reportStoreError("corrupt-file", { file, savedAs: null });
    return { status: "corrupt", savedAs: null };
  }
}

/**
 * readJson for a store whose empty state is a shape rather than a null. The
 * fallback is copied before it is returned, so a caller may hold its empty
 * state in a module-level constant: what one read hands back and the caller
 * then mutates is never what the next read hands back. The value is a JSON
 * store's empty state, which structuredClone always handles.
 */
export async function readJsonOr<T>(
  file: string,
  fallback: T,
  validate?: (raw: unknown) => T | null,
): Promise<T> {
  const value = await readJson<T>(file, validate);
  return value ?? structuredClone(fallback);
}
