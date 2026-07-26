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
  remove,
  writeFile,
} from "@tauri-apps/plugin-fs";

export const BASE_DIR = "sync-base";

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
