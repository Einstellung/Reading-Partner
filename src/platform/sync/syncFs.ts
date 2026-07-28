// What files the engine syncs, and the filesystem surface it needs. Both are
// injected into the engine so the reconcile loop runs headless in tests.
//
// Sync range (docs/13): the user's own data — reading position, marks, AI
// threads, topics, per-topic memory, lesson-prep plans and notes, book notes
// (docs/14), the cross-scenario user profile and info feedback log (docs/16), and app
// settings. Book PDFs travel the separate books channel
// (content-addressed blobs), never the data channel. Excluded: derived caches
// (fulltext-*, figures-*, prep-*/pdf and its caches), generated slide decks
// (slides/**, docs/14 — a build output, rebuildable from notes), the local
// event log, sync's own local
// files (sync-auth.json, sync-state.json, and the sync-base/ merge-base mirror
// — syncing the record of what was last agreed would be circular), and
// credentials.json — plaintext AI
// provider tokens stay on the device rather than widening their exposure to the
// user's Drive, and per-device tokens avoid refresh-rotation kicking the other
// device out. Thread images (images/**) are not synced in v1 — a screenshot
// pasted on one device shows as a missing image on the other, which
// readThreadImages already tolerates.

import {
  BaseDirectory,
  mkdir,
  readDir,
  readFile,
  stat,
  writeFile,
} from "@tauri-apps/plugin-fs";
import { writeTextAtomic } from "../app/atomic-fs";

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
  // Every in-range file with its mtime/size. Deliberately does not hash: the
  // 15s tick calls this, and reading every file each tick to learn nothing is
  // not a pre-filter. The pass hashes what the pre-filter flags.
  list(): Promise<ScannedFile[]>;
  read(path: string): Promise<Uint8Array>;
  // Writes bytes, creating any parent directory first.
  write(path: string, bytes: Uint8Array): Promise<void>;
  stat(path: string): Promise<{ mtime: number; size: number } | null>;
}

const ROOT_FILES = new Set([
  "library.json",
  "reading-state.json",
  "settings.json",
  "topics.json",
  // The cross-scenario user profile (both the briefing and the reading companion
  // read it), the subscribed source list, and the append-only feedback log travel
  // between devices; the daily briefing-*.json / info-articles-* caches and the
  // info-source-health.json sidecar are derived and stay out of range (matched by
  // nothing below). info-profile.md is the profile's old name — kept in range
  // during the transition so a device still on the old build stays in step.
  "user-profile.md",
  "info-profile.md",
  "info-sources.json",
  "info-feedback.jsonl",
  // Articles the reader kept out of a briefing (docs/21). Body snapshots ride
  // along inside the records for now — stripped of inlined images, so a record
  // is text, not re-encoded JPEGs.
  "saved-articles.json",
]);

// Whether an AppData-relative path (forward-slash separators) is synced.
export function inSyncRange(path: string): boolean {
  const parts = path.split("/");
  const top = parts[0];
  if (parts.length === 1) {
    if (ROOT_FILES.has(top)) return true;
    return /^annotations-.+\.json$/.test(top) || /^threads-.+\.json$/.test(top);
  }
  // Per-topic memory: every file under memory-<topicId>/ (entries, index, meta).
  if (top.startsWith("memory-")) return true;
  // Lesson prep: the plan state and the per-paper notes, but not the downloaded
  // PDFs (prep-*/pdf/**) or any other nested cache.
  if (top.startsWith("prep-") && parts.length === 2) {
    const name = parts[1];
    return name === "state.json" || name.endsWith(".md");
  }
  // Book notes (docs/14): the plan state and the per-chapter / overview notes.
  if (top.startsWith("notes-") && parts.length === 2) {
    const name = parts[1];
    return name === "state.json" || name.endsWith(".md");
  }
  return false;
}

// --- Tauri implementation --------------------------------------------------

const opts = { baseDir: BaseDirectory.AppData } as const;

async function walk(dir: string, out: ScannedFile[]): Promise<void> {
  let entries;
  try {
    entries = await readDir(dir || ".", opts);
  } catch {
    return;
  }
  for (const e of entries) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory) {
      // Only descend into directories that can hold in-range files.
      if (rel.startsWith("memory-") || rel.startsWith("prep-") || rel.startsWith("notes-")) {
        await walk(rel, out);
      }
      continue;
    }
    if (!e.isFile || !inSyncRange(rel)) continue;
    try {
      const info = await stat(rel, opts);
      out.push({ path: rel, mtime: info.mtime ? info.mtime.getTime() : 0, size: info.size });
    } catch {
      // A file that vanished between readDir and stat is simply skipped.
    }
  }
}

export const tauriSyncFs: SyncFs = {
  async list() {
    const out: ScannedFile[] = [];
    await walk("", out);
    return out;
  },
  read(path) {
    return readFile(path, opts);
  },
  async write(path, bytes) {
    // Every in-range file is UTF-8 text this app wrote, so a pull lands through
    // the atomic writer (which also creates the parent directory): a pull is
    // exactly when a torn write would be worst — half of the other device's
    // library.json, then a local import overwriting the rest. Bytes that are
    // not valid UTF-8 can't be ours; keep them verbatim rather than mangling
    // them, and let the loader quarantine the file.
    let text: string | null = null;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      text = null;
    }
    if (text !== null) {
      await writeTextAtomic(path, text);
      return;
    }
    const slash = path.lastIndexOf("/");
    if (slash > 0) await mkdir(path.slice(0, slash), { ...opts, recursive: true });
    await writeFile(path, bytes, opts);
  },
  async stat(path) {
    try {
      const info = await stat(path, opts);
      return { mtime: info.mtime ? info.mtime.getTime() : 0, size: info.size };
    } catch {
      return null;
    }
  },
};
