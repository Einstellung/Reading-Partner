// What files the engine syncs, and the filesystem surface it needs. Both are
// injected into the engine so the reconcile loop runs headless in tests.
//
// Sync range (docs/13): the user's own data, and nothing derived or per-device.
// Which of the two a file is, and why, is one row per kind in the palace table
// (src/palace/kinds.ts, docs/61) rather than a list restated here — the range,
// the never-infer-delete set and the walk's descend rule are all folds over it,
// so they cannot disagree with each other any more. Book PDFs travel the
// separate books channel (content-addressed blobs), never the data channel.

import { resolvePalace, rowsWhere } from "../../palace";
import { appData } from "../app/appdata";
import { writeBytesAtomic } from "../app/atomic-fs";

// What a scan of the sync range sees: one stat per file, nothing read.
export interface ScannedFile {
  path: string;
  mtime: number;
  size: number;
}

// A scanned file with the hash of its bytes. This, not ScannedFile, is what the
// pass decides on — see content.ts for why mtime cannot be trusted.
export interface LocalFile extends ScannedFile {
  hash: string;
}

export interface SyncFs {
  // Every in-range file with its mtime/size. A readDir of the range plus one
  // stat per file — two hundred-odd round trips through the IPC, which is why
  // nothing but a pass calls it any more (engine.ts). Deliberately does not
  // hash: mtime and size rule a file out without reading it, and the pass
  // hashes only what they flag.
  list(): Promise<ScannedFile[]>;
  read(path: string): Promise<Uint8Array>;
  // Writes bytes, creating any parent directory first.
  write(path: string, bytes: Uint8Array): Promise<void>;
  stat(path: string): Promise<{ mtime: number; size: number } | null>;
  // Takes a local file away. Reached only for a path a tombstone has named
  // (dead-paths.ts) — the reconcile loop still never deletes anything on its own
  // reading of the two sides (docs/13). A path that is already gone is success,
  // not an error: that is the state this asks for.
  remove(path: string): Promise<void>;
}

// The three lists below were hand-written and never checked against each other.
// They are folds over the palace table now (src/palace, docs/61): a new data
// file is one row there rather than three edits here that drift apart.

// Exported for tests/platform/sync/pull-coverage.test.ts, which walks it: every
// synced file has to be claimed by a pull route or written down as having no
// in-memory copy for a pull to go stale against.
//
// The fixed names at the AppData root that travel on the data channel. A kind
// whose name varies (annotations-<bookId>.json) is not one of these and is
// reached through inSyncRange instead.
export const ROOT_FILES = new Set(
  rowsWhere((r) => r.sync === "data" && r.id === "fixed")
    .map((r) => r.samples[0] as string)
    .filter((name) => !name.includes("/")),
);

// The paths a tree comparison may never conclude are deleted (docs/59 §8.8).
// They are cursors and append-only logs: losing observations/meta.json throws
// away every distillation cursor and re-reads every conversation from zero, and
// losing a tombstone log makes a deletion that already travelled come back. A
// deletion of one of these is only ever accepted from an explicit tombstone.
//
// Every one of them is a fixed name, so the row's first sample is the path.
export const NEVER_INFER_DELETE = new Set(
  rowsWhere((r) => r.neverInferDelete === true).map((r) => r.samples[0] as string),
);

// Whether an AppData-relative path (forward-slash separators) is synced. The
// palace says which channel carries a path; the data channel is the sync range,
// and a path no row claims is not in it.
export function inSyncRange(path: string): boolean {
  return resolvePalace(path)?.row.sync === "data";
}

// The kinds that declare a descend rule: the only directories the walk enters.
const DIR_ROWS = rowsWhere((r) => r.dir !== undefined);

// Whether a directory can hold an in-range file, so the walk descends into it.
// Spelled out by the rows rather than left at "anything under prep-", which
// would open every prep-<bookId>/pdf/ to a readDir that can only ever return
// files inSyncRange rejects.
function worthDescending(rel: string): boolean {
  const parts = rel.split("/");
  const head = parts[0] ?? "";
  for (const row of DIR_ROWS) {
    const d = row.dir;
    if (!d) continue;
    const owns = d.prefix.endsWith("-") ? head.startsWith(d.prefix) : head === d.prefix;
    if (!owns) continue;
    if (parts.length > d.depth) continue;
    if (parts.length === 1) return true;
    // Below the top level, either the one named subdirectory is allowed
    // (prep-<bookId>/chapters) or every name is (runs/<rehearsalId>).
    if (d.nested === undefined || parts[1] === d.nested) return true;
  }
  return false;
}

// --- Tauri implementation --------------------------------------------------

async function walk(dir: string, out: ScannedFile[]): Promise<void> {
  let entries;
  try {
    entries = await appData.readDir(dir || ".");
  } catch {
    return;
  }
  for (const e of entries) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory) {
      // Only descend into directories that can hold in-range files.
      if (worthDescending(rel)) await walk(rel, out);
      continue;
    }
    if (!e.isFile || !inSyncRange(rel)) continue;
    // A file that vanished between readDir and stat has no stat to take: null,
    // and it is simply skipped. Not a throw to swallow — appData.stat answers
    // null for a file it cannot read, so this test is the whole of the
    // handling and dropping it would empty every scan.
    const info = await appData.stat(rel);
    if (!info) continue;
    out.push({ path: rel, mtime: info.mtimeMs, size: info.size });
  }
}

export const tauriSyncFs: SyncFs = {
  async list() {
    const out: ScannedFile[] = [];
    await walk("", out);
    return out;
  },
  read(path) {
    return appData.readBytes(path);
  },
  // Every in-range file is UTF-8 text this app wrote, so a pull lands through the
  // atomic writer: a pull is exactly when a torn write would be worst — half of
  // the other device's library.json, then a local import overwriting the rest.
  // Where the atomic/plain line is drawn, and why, is writeBytesAtomic's.
  write(path, bytes) {
    return writeBytesAtomic(path, bytes);
  },
  async stat(path) {
    const info = await appData.stat(path);
    return info === null ? null : { mtime: info.mtimeMs, size: info.size };
  },
  async remove(path) {
    try {
      await appData.remove(path);
    } catch {
      // Already gone, which is the state this asks for. appData.remove throws on
      // a missing path and the pass must not fail over a file it wanted deleted
      // anyway.
    }
  },
};
