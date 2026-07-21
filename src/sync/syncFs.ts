// What files the engine syncs, and the filesystem surface it needs. Both are
// injected into the engine so the reconcile loop runs headless in tests.
//
// Sync range (docs/13): the user's own data — reading position, marks, AI
// threads, topics, per-topic memory, lesson-prep plans and notes, book notes
// (docs/14), the info-triage profile and feedback log (docs/16), and app
// settings. Book PDFs travel the separate books channel
// (content-addressed blobs), never the data channel. Excluded: derived caches
// (fulltext-*, figures-*, prep-*/pdf and its caches), generated slide decks
// (slides/**, docs/14 — a build output, rebuildable from notes), the local
// event log, sync's own local
// files (sync-auth.json, sync-state.json), and credentials.json — plaintext AI
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

export interface LocalFile {
  path: string;
  mtime: number;
  size: number;
}

export interface SyncFs {
  // Every in-range file with its mtime/size.
  list(): Promise<LocalFile[]>;
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
  // Info triage (docs/16): the reader's own profile and append-only feedback
  // log travel between devices; the daily briefing-*.json and info-articles-*
  // caches are derived and stay out of range (matched by nothing below).
  "info-profile.md",
  "info-feedback.jsonl",
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

async function walk(dir: string, out: LocalFile[]): Promise<void> {
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
    const out: LocalFile[] = [];
    await walk("", out);
    return out;
  },
  read(path) {
    return readFile(path, opts);
  },
  async write(path, bytes) {
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
