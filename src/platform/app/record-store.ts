// One record per file in the AppData root, named `<prefix><id>.json`, listed by
// walking the directory rather than by keeping a registry: two devices starting
// a record each would otherwise write the same registry and one of them would
// lose. Retells, talk outlines and rehearsals are all this shape.
//
// Only the mechanical half is here — the name, the read, the write, the listing
// and the reservation of a free id. What a record is, what it may be edited
// into, and what else has to go when one is deleted stay with the domain that
// owns it: the delete of a record is never only its own file, and the order the
// remote copy is queued in belongs beside the reason (pitfall 208).

import { appData } from "./appdata";
import { readGuardedJson, writeTextAtomic } from "./atomic-fs";

/**
 * What a file that will not read does. `warn` logs and answers null, for a
 * listing that must still draw when one record is unreadable. `guard` moves the
 * bad content aside first (readGuardedJson), for a record whose caller is about
 * to write the file back — pitfall 339 is a loader that answers empty and a
 * writer that then makes the empty version the only one left.
 */
export type RecordRead = { kind: "warn"; message: string } | { kind: "guard" };

export interface RecordStoreOptions<T> {
  /** The file name is this and then the id and then `.json`. */
  prefix: string;
  /** Turns what was on disk into a record, or null for a shape this build cannot use. */
  parse: (raw: unknown) => T | null;
  /** The key the listing sorts on, descending: newest first. */
  newest: (record: T) => number;
  /** The id a record created at this moment takes. */
  newId: (at: number) => string;
  read: RecordRead;
}

export interface RecordStore<T extends { id: string }> {
  /** Where a record with this id lives. */
  file(id: string): string;
  /** An id out of a file name, or null for anything else in the directory. */
  idOf(fileName: string): string | null;
  /** The record, or null when there is none this build can use. Missing is normal. */
  load(id: string): Promise<T | null>;
  save(record: T): Promise<void>;
  /** Every record on disk, newest first. Unreadable files are skipped. */
  listAll(): Promise<T[]>;
  /**
   * An id nothing on disk is using, and the moment it stands for. The id is the
   * creation time, and a name already taken steps to the next free millisecond,
   * so two records created in one gesture cannot land on one name.
   */
  reserveId(now?: number): Promise<{ id: string; at: number }>;
}

export function createRecordStore<T extends { id: string }>(
  options: RecordStoreOptions<T>,
): RecordStore<T> {
  const { prefix, parse, newest, newId, read } = options;

  function file(id: string): string {
    return `${prefix}${id}.json`;
  }

  // The prefix is checked at the start of the name, so a file that only carries
  // this prefix somewhere inside it — threads-retell-<id>.json beside a retell —
  // is not one of these.
  function idOf(fileName: string): string | null {
    if (!fileName.startsWith(prefix) || !fileName.endsWith(".json")) return null;
    const id = fileName.slice(prefix.length, -".json".length);
    return id || null;
  }

  async function load(id: string): Promise<T | null> {
    if (read.kind === "guard") {
      const guarded = await readGuardedJson(file(id), parse);
      return guarded.status === "ok" ? guarded.value : null;
    }
    try {
      const name = file(id);
      if (!(await appData.exists(name))) return null;
      return parse(JSON.parse(await appData.readText(name)) as unknown);
    } catch (e) {
      console.warn(read.message, id, e);
      return null;
    }
  }

  return {
    file,
    idOf,
    load,

    async save(record) {
      await writeTextAtomic(file(record.id), JSON.stringify(record, null, 2));
    },

    async listAll() {
      let entries;
      try {
        entries = await appData.readDir(".");
      } catch {
        return [];
      }
      const out: T[] = [];
      for (const e of entries) {
        if (!e.isFile || !e.name) continue;
        const id = idOf(e.name);
        if (!id) continue;
        const record = await load(id);
        if (record) out.push(record);
      }
      return out.sort((a, b) => newest(b) - newest(a));
    },

    async reserveId(now = Date.now()) {
      let at = now;
      while (await appData.exists(file(newId(at)))) at += 1;
      return { id: newId(at), at };
    },
  };
}

/**
 * Take local files away, one failure at a time: a file that cannot be removed
 * must not stop the ones after it. A file that is not there is not an error,
 * which is why the existence check is here rather than the catch.
 */
export async function removeRecordFiles(files: readonly string[]): Promise<void> {
  for (const file of files) {
    try {
      if (await appData.exists(file)) await appData.remove(file);
    } catch (e) {
      console.warn("failed to delete", file, e);
    }
  }
}
