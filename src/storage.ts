// Reading-state + recent-files persistence in a single JSON file under appdata.
// Keyed by a hash of the absolute file path so reopening restores position.

import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
// Note: capability globs like $APPDATA/** do not match $APPDATA itself;
// capabilities/default.json must also allow the bare $APPDATA path.
import type { ViewState } from "./reader";

const LIBRARY_FILE = "library.json";
const RECENT_LIMIT = 5;

export interface FileEntry {
  path: string;
  name: string;
  viewState: ViewState | null;
  updatedAt: number;
}

interface Library {
  files: Record<string, FileEntry>;
}

// djb2 — stable key from an absolute path, avoids filesystem-unsafe chars.
export function hashPath(path: string): string {
  let h = 5381;
  for (let i = 0; i < path.length; i++) {
    h = ((h << 5) + h + path.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

export function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

// Recent files: most-recently-updated first, capped at RECENT_LIMIT.
export function recentEntries(lib: Library): FileEntry[] {
  return Object.values(lib.files)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, RECENT_LIMIT);
}

async function ensureDir(): Promise<void> {
  // recursive mkdir is a no-op on an existing directory; if it fails for
  // another reason, the subsequent write surfaces the real error anyway
  try {
    await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true });
  } catch {
    // ignore
  }
}

async function loadLibrary(): Promise<Library> {
  try {
    if (!(await exists(LIBRARY_FILE, { baseDir: BaseDirectory.AppData }))) {
      return { files: {} };
    }
    const text = await readTextFile(LIBRARY_FILE, {
      baseDir: BaseDirectory.AppData,
    });
    const parsed = JSON.parse(text) as Library;
    return parsed.files ? parsed : { files: {} };
  } catch {
    return { files: {} };
  }
}

async function saveLibrary(lib: Library): Promise<void> {
  await ensureDir();
  await writeTextFile(LIBRARY_FILE, JSON.stringify(lib, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}

export async function getRecents(): Promise<FileEntry[]> {
  return recentEntries(await loadLibrary());
}

export async function getEntry(path: string): Promise<FileEntry | null> {
  const lib = await loadLibrary();
  return lib.files[hashPath(path)] ?? null;
}

// Record an open (or a view-state change) for a file.
export async function upsertEntry(
  path: string,
  viewState: ViewState | null,
): Promise<void> {
  const lib = await loadLibrary();
  const key = hashPath(path);
  const prev = lib.files[key];
  lib.files[key] = {
    path,
    name: basename(path),
    viewState: viewState ?? prev?.viewState ?? null,
    updatedAt: Date.now(),
  };
  await saveLibrary(lib);
}
