// In-memory MemoryFs for the memory tests: the store runs its whole write path
// against a Map, no Tauri involved.

import type { MemoryFs } from "../../src/memory/store";

export function makeFakeFs(): { fs: MemoryFs; files: Map<string, string> } {
  const files = new Map<string, string>();
  const fs: MemoryFs = {
    async read(path) {
      return files.get(path) ?? null;
    },
    async write(path, content) {
      files.set(path, content);
    },
    async remove(path) {
      files.delete(path);
    },
    async listDir(dir) {
      const prefix = dir.endsWith("/") ? dir : `${dir}/`;
      const names: string[] = [];
      for (const key of files.keys()) {
        const rest = key.startsWith(prefix) ? key.slice(prefix.length) : null;
        if (rest && !rest.includes("/")) names.push(rest);
      }
      return names;
    },
  };
  return { fs, files };
}

// A fixed "now" for deterministic dates in tests.
export const JULY_17 = new Date("2026-07-17T12:00:00Z").getTime();
export const JULY_20 = new Date("2026-07-20T12:00:00Z").getTime();
