// The engine's view of the local book library: which books exist (per
// library.json) and read/write their content-addressed blobs. Injected so the
// books-channel logic is testable without the real filesystem.

import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeFile,
} from "@tauri-apps/plugin-fs";
import { libraryHas, libraryPdfPath, readLibraryBook, type LibraryStore } from "../app/library";

export interface BookFs {
  // Book ids listed in library.json (the authoritative set to reconcile).
  listHashes(): Promise<string[]>;
  has(hash: string): Promise<boolean>;
  read(hash: string): Promise<Uint8Array>;
  write(hash: string, bytes: Uint8Array): Promise<void>;
}

const opts = { baseDir: BaseDirectory.AppData } as const;

export const tauriBookFs: BookFs = {
  async listHashes() {
    try {
      if (!(await exists("library.json", opts))) return [];
      const store = JSON.parse(await readTextFile("library.json", opts)) as LibraryStore;
      return store?.books ? Object.keys(store.books) : [];
    } catch {
      return [];
    }
  },
  has(hash) {
    return libraryHas(hash);
  },
  read(hash) {
    return readLibraryBook(hash);
  },
  async write(hash, bytes) {
    await mkdir("library", { ...opts, recursive: true });
    await writeFile(libraryPdfPath(hash), bytes, opts);
  },
};
