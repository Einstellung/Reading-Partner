// Reading-position persistence, keyed by a hash of the absolute file path so
// reopening a document restores where you were. Recency is tracked per-topic
// (see topics.ts), so this no longer keeps a global recents list.

import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
// Capability globs like $APPDATA/** do not match $APPDATA itself, so
// capabilities/default.json must also allow the bare $APPDATA path (pitfall 09).
import type { ViewState } from "./reader";

const STATE_FILE = "reading-state.json";

// djb2 — stable key from an absolute path, filesystem-safe. Shared by topics
// and annotation storage so a file maps to one key everywhere.
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

interface Store {
  states: Record<string, ViewState>;
}

async function ensureDir(): Promise<void> {
  try {
    if (!(await exists("", { baseDir: BaseDirectory.AppData }))) {
      await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true });
    }
  } catch {
    // A real problem resurfaces on the write below.
  }
}

async function load(): Promise<Store> {
  try {
    if (!(await exists(STATE_FILE, { baseDir: BaseDirectory.AppData }))) {
      return { states: {} };
    }
    const parsed = JSON.parse(
      await readTextFile(STATE_FILE, { baseDir: BaseDirectory.AppData }),
    ) as Store;
    return parsed.states ? parsed : { states: {} };
  } catch {
    return { states: {} };
  }
}

async function save(store: Store): Promise<void> {
  await ensureDir();
  await writeTextFile(STATE_FILE, JSON.stringify(store, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}

export async function getViewState(path: string): Promise<ViewState | null> {
  const store = await load();
  return store.states[hashPath(path)] ?? null;
}

export async function saveViewState(path: string, state: ViewState): Promise<void> {
  const store = await load();
  store.states[hashPath(path)] = state;
  await save(store);
}
