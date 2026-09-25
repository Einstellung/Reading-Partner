// One JSON file whose contents nothing can rebuild, read through
// readGuardedJson and written back whole, with the disk injected: the shape the
// source list, the labs, the pictures, the cables, the meals and the kept
// articles all have. A test hands a store an in-memory AppData instead of
// rewriting the module registry with mock.module, which rewrites it for every
// other test file in the same worker (pitfall 119).
//
// Only the disk and the two decisions every such store makes the same way are
// here: what a read that did not produce a value means, and what has to happen
// before a write that drops part of what was read. What the file holds, which
// entries a write carries through, and when the file counts as repaired stay
// with the store that owns it.

import {
  quarantineFile,
  readGuardedJson,
  writeTextAtomic,
  type CorruptFileReport,
  type GuardedRead,
} from "./atomic-fs";
import { reportStoreError } from "./store-errors";

/** What such a store needs of a disk. */
export interface GuardedFileIo<T> {
  /** readGuardedJson: bad content is moved aside before the corrupt answer. */
  read(file: string, validate: (raw: unknown) => T | null): Promise<GuardedRead<T>>;
  /** Written whole, and atomically. */
  write(file: string, contents: string): Promise<void>;
  /** Move the file aside as `<name>.corrupt-<ms>`; the new name, or null for nothing moved. */
  quarantine(file: string): Promise<string | null>;
  /** Tell the reader a file was set aside, or could not be. */
  reportCorrupt(report: CorruptFileReport): void;
}

/** The AppData on this device. */
export function appGuardedFileIo<T>(): GuardedFileIo<T> {
  return {
    read: readGuardedJson,
    write: writeTextAtomic,
    quarantine: quarantineFile,
    reportCorrupt: (report) => reportStoreError("corrupt-file", report),
  };
}

/**
 * The file's value, or null when there is none to have: no file yet, or bad
 * content that the read has just moved aside. A file that is sitting there
 * unread raises instead. Every writer of such a file reads before it saves, so
 * answering that case with the caller's empty state would have the next save
 * write the empty state over everything the reader had.
 */
export async function readGuardedFile<T>(
  io: Pick<GuardedFileIo<T>, "read">,
  file: string,
  validate: (raw: unknown) => T | null,
): Promise<T | null> {
  const read = await io.read(file, validate);
  if (read.status === "ok") return read.value;
  if (read.status === "missing") return null;
  if (read.savedAs === null) throw new Error(`${file} could not be read`);
  return null;
}

/**
 * Move the file's bytes aside before a write that drops entries the read could
 * not place, so those entries survive it, and tell the reader where they went.
 * False when they could not be moved: the caller must not write then, or the
 * entries would exist nowhere.
 */
export async function quarantineBeforeWrite(
  io: Pick<GuardedFileIo<unknown>, "quarantine" | "reportCorrupt">,
  file: string,
): Promise<boolean> {
  let savedAs: string | null = null;
  try {
    savedAs = await io.quarantine(file);
  } catch (e) {
    console.error(`failed to quarantine ${file}`, e);
  }
  io.reportCorrupt({ file, savedAs });
  return savedAs !== null;
}
