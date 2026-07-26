// The local-only files sync keeps beside the user's data. Neither is ever
// uploaded: they are this device's bookkeeping about the sync, the same way
// sync-state.json is.
//
// sync-base/  — the bytes of every synced data file as they stood at the last
//               successful sync, mirroring the AppData-relative path. This is
//               the merge base: with it a three-way merge can tell an edit from
//               a delete and keep both sides' work; without it a conflict can
//               only guess. It sits outside the sync range (syncFs.ts), so it
//               never syncs itself and never shows up in a plan.
//
// sync-trash.jsonl — every record a merge removed because the other side had
//               deleted it. Record-level deletions do propagate (whole files
//               never do), so this is what keeps one recoverable: the merge
//               reports what it dropped and this journals it, on this device
//               only, for thirty days.
//
// A base is written whenever a file is successfully uploaded or downloaded —
// exactly the moments both sides are known to agree on its content — and
// dropped when the file is gone from both sides. A missing base is legal: the
// first pass after this landed has none, nor does a file this device never
// pulled, and the merge contract handles that case.

import {
  BaseDirectory,
  exists,
  mkdir,
  readFile,
  readTextFile,
  remove,
  writeFile,
} from "@tauri-apps/plugin-fs";
import { writeTextAtomic } from "../app/atomic-fs";

export const BASE_DIR = "sync-base";
export const TRASH_FILE = "sync-trash.jsonl";

// Long enough that a delete propagated while a device was offline is still
// recoverable when it comes back, short enough that the journal cannot grow
// without bound.
export const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface BaseStore {
  // The last agreed content, or null when this device has none for the path.
  read(path: string): Promise<Uint8Array | null>;
  has(path: string): Promise<boolean>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
}

const opts = { baseDir: BaseDirectory.AppData } as const;

function basePath(path: string): string {
  return `${BASE_DIR}/${path}`;
}

export const tauriBaseStore: BaseStore = {
  async read(path) {
    try {
      return await readFile(basePath(path), opts);
    } catch {
      return null;
    }
  },
  async has(path) {
    try {
      return await exists(basePath(path), opts);
    } catch {
      return false;
    }
  },
  async write(path, bytes) {
    const full = basePath(path);
    const slash = full.lastIndexOf("/");
    await mkdir(full.slice(0, slash), { ...opts, recursive: true });
    await writeFile(full, bytes, opts);
  },
  async remove(path) {
    try {
      await remove(basePath(path), opts);
    } catch {
      // Already gone, which is the state this asks for.
    }
  },
};

// --- the delete journal -----------------------------------------------------

export interface TrashEntry {
  // When this device journalled it, not when the deleting device acted: the
  // pass has no honest reading of the other device's clock.
  at: number;
  // The file the record was merged out of.
  path: string;
  id: string;
  record: unknown;
}

export interface TrashJournal {
  append(entries: TrashEntry[]): Promise<void>;
  // Drops entries older than TRASH_TTL_MS. Called once per pass.
  prune(now: number): Promise<void>;
}

// The kept lines, or null when nothing would change — so a pass over a journal
// that is already current writes nothing. A line that will not parse is kept:
// it is a record the user might still want, and this is the only copy.
export function pruneTrashText(text: string, now: number): string | null {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  const kept = lines.filter((line) => {
    try {
      const at = (JSON.parse(line) as Partial<TrashEntry>).at;
      return typeof at !== "number" || now - at < TRASH_TTL_MS;
    } catch {
      return true;
    }
  });
  if (kept.length === lines.length) return null;
  return kept.length === 0 ? "" : `${kept.join("\n")}\n`;
}

async function readTrash(): Promise<string> {
  try {
    if (!(await exists(TRASH_FILE, opts))) return "";
    return await readTextFile(TRASH_FILE, opts);
  } catch {
    return "";
  }
}

export const tauriTrashJournal: TrashJournal = {
  async append(entries) {
    if (entries.length === 0) return;
    const added = entries.map((e) => JSON.stringify(e)).join("\n");
    await writeTextAtomic(TRASH_FILE, `${await readTrash()}${added}\n`);
  },
  async prune(now) {
    const pruned = pruneTrashText(await readTrash(), now);
    if (pruned === null) return;
    await writeTextAtomic(TRASH_FILE, pruned);
  },
};
