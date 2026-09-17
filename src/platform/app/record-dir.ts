// One record per file under a directory of its own, with the disk injected: the
// shape the box, the runs, the bells and the ledger all have. Two devices write
// these directories and neither can lock one, so the stores over them are thin —
// they read a file, decide, and write it back whole — and the tests hand in a
// Map instead of a disk.
//
// Only the disk is here. What a record is and what moving one means stay with
// the store that owns it.

import { appData } from "./appdata";

/** What such a store needs of a disk. */
export interface RecordDirIo {
  /** The file names in the directory. Empty when there is no directory. */
  list(): Promise<string[]>;
  /** A file's text, or null when it is not there. */
  read(name: string): Promise<string | null>;
  /** Written whole, and atomically: a half-written record is one nobody can merge. */
  write(name: string, contents: string): Promise<void>;
}

/** A disk a record can also be taken off, for a store that has somewhere to put it first. */
export interface RemovableRecordDirIo extends RecordDirIo {
  /**
   * Take a file away. Local only: sync propagates no file deletion of its own
   * (pitfall 208), so whoever calls this owes the remote half as well.
   */
  remove(name: string): Promise<void>;
}

/** One of these directories on this device. */
export function appRecordDirIo(dir: string): RemovableRecordDirIo {
  return {
    async list() {
      const entries = await appData.readDir(dir).catch(() => []);
      return entries.filter((e) => e.isFile).map((e) => e.name);
    },
    async read(name) {
      const path = `${dir}/${name}`;
      if (!(await appData.exists(path))) return null;
      return appData.readText(path).catch(() => null);
    },
    async write(name, contents) {
      await appData.mkdirp(dir);
      await appData.writeAtomic(`${dir}/${name}`, contents);
    },
    async remove(name) {
      await appData.remove(`${dir}/${name}`).catch(() => {});
    },
  };
}

/** Where a record with this id lives inside its directory. */
export function recordFileName(id: string): string {
  return `${id}.json`;
}

/**
 * An id out of a file name, or null for anything else in the directory. `shape`
 * is what the ids of this kind look like: an id has to be a file name, and file
 * names that need escaping are file names two ids can collide on.
 */
export function recordIdOf(name: string, shape: RegExp): string | null {
  if (!name.endsWith(".json")) return null;
  const id = name.slice(0, -".json".length);
  return shape.test(id) ? id : null;
}

/**
 * Read one record back off the disk rather than out of what this process
 * remembers writing: a pull may have landed the other device's copy since.
 * Null for an id of the wrong shape, a file that is not there, one that will
 * not parse, and one whose contents answer to a different id.
 */
export function createRecordReader<T extends { id: string }>(
  io: RecordDirIo,
  shape: RegExp,
  parse: (raw: unknown) => T | null,
): (id: string) => Promise<T | null> {
  return async (id) => {
    if (!shape.test(id)) return null;
    const text = await io.read(recordFileName(id));
    if (text === null) return null;
    try {
      const record = parse(JSON.parse(text) as unknown);
      return record && record.id === id ? record : null;
    } catch {
      return null;
    }
  };
}

/**
 * Every record in the directory this build can read, in whatever order the disk
 * listed them. A file that will not parse is not a record anybody can act on,
 * and it is left where it is: deleting it would take the only evidence of what
 * went wrong with it.
 */
export async function readRecords<T>(
  io: RecordDirIo,
  shape: RegExp,
  read: (id: string) => Promise<T | null>,
): Promise<T[]> {
  const out: T[] = [];
  for (const name of await io.list()) {
    const id = recordIdOf(name, shape);
    if (!id) continue;
    const record = await read(id);
    if (record) out.push(record);
  }
  return out;
}
