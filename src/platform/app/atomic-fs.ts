// Durability policy for data files. Not filesystem access — that is appdata.ts,
// and every disk touch below goes through it.
//
// Every JSON/markdown store writes through writeTextAtomic (temp + fsync +
// rename in Rust, src-tauri/src/atomic_fs.rs) rather than a truncate-in-place
// write, so a process death mid-write cannot leave a half file behind.
//
// The other half of the same problem is on the read side: most loaders treat an
// unparseable file as "empty" and the next save then makes that permanent. For
// data the app cannot rebuild (the shelf, settings, credentials) readGuardedJson
// moves the bad file aside first, so the fallback is never destructive.
//
// Binary blobs (library PDFs, pasted images) are written plainly, through
// appData.writeBytes: they are content-addressed and re-derivable, and passing
// hundreds of megabytes through the IPC as a JSON number array is not viable
// (pitfall 29).

import { BaseDirectory } from "@tauri-apps/plugin-fs";
import { appData } from "./appdata";
import { reportStoreError } from "./store-errors";

/**
 * The base every data file in the app is addressed from. Passed to the fs
 * plugin as-is, spread when a call needs more (`{ ...APPDATA, recursive: true }`).
 *
 * On its way out: the callers that still pass it are being moved onto appData,
 * which says the base once. This and the plugin import above go with the last
 * of them.
 */
export const APPDATA = { baseDir: BaseDirectory.AppData } as const;

// Who to tell when a file is replaced. A store that holds a file's contents in
// memory between reads is only right for as long as nothing else replaces the
// file, and two things do: a sync pull landing the other device's copy, and the
// key migration (migrate.ts). Both write through writeTextAtomic, as does every
// other text write in the app, so this is where that can be said once — at the
// moment the held copy stops being the file, rather than at the end of whatever
// pass replaced it.
//
// The one text write that does not come through here is syncFs.write's fallback
// for bytes that are not valid UTF-8. Nothing this app wrote is invalid UTF-8, so
// a file arriving that way is not one any store here has a copy of.
const writeListeners = new Set<(path: string) => void>();

/**
 * Hear about every AppData text file replaced through writeTextAtomic, by
 * relative path, after the bytes have landed. Returns the undo.
 */
export function onFileWritten(listener: (path: string) => void): () => void {
  writeListeners.add(listener);
  return () => {
    writeListeners.delete(listener);
  };
}

/** Replace an AppData-relative text file atomically. Parent dirs are created. */
export async function writeTextAtomic(path: string, contents: string): Promise<void> {
  await appData.writeAtomic(path, contents);
  // A listener exists to drop something; one that throws must not turn a write
  // that landed into a write that failed.
  for (const listener of [...writeListeners]) {
    try {
      listener(path);
    } catch (e) {
      console.error(`write listener failed for ${path}`, e);
    }
  }
}

/**
 * Move an unparseable AppData-relative file aside as `<name>.corrupt-<unix-ms>`.
 * Resolves to the new name, or null when there was nothing to move.
 */
export function quarantineFile(path: string): Promise<string | null> {
  return appData.quarantine(path);
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
    if (!(await appData.exists(file))) return { status: "missing" };
    text = await appData.readText(file);
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
    if (!(await appData.exists(file))) return null;
    const raw = JSON.parse(await appData.readText(file)) as unknown;
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
    if (!(await appData.exists(file))) return { status: "missing" };
    return { status: "ok", value: await appData.readText(file) };
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
