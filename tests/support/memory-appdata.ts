// An AppData that is two Maps, handed straight to the port's consumers rather
// than spied onto the host packages.
//
// tests/support/appdata-fake.ts is the other one and stays the right tool for a
// store test: it spies @tauri-apps/plugin-fs so the code under test is the real
// appdata.ts. Its disk is flat, though — readDir returns every key — and the
// harness's session store is a tree two levels deep whose listings decide which
// sessions exist. So this one is a tree, and it is passed in as an AppDataFs
// rather than installed, because that is how createSessionFileSystem takes it.
//
// Literal where it matters: a read of what is not there throws the way the
// plugin throws, writeBytes and appendText need their parent directory to exist
// and writeAtomic creates it, and removing a directory that still has children
// fails unless the removal is recursive. Every one of those is a way the
// session store could be wrong on a device and right in a test.

import type { AppDataFs, DirEntry, FileInfo } from "../../src/platform/app/appdata";

export interface MemoryDisk extends AppDataFs {
  /** File contents, by AppData-relative path. */
  files: Map<string, Uint8Array>;
  /** Directories that exist, by AppData-relative path. */
  dirs: Set<string>;
  /** Every path written, in order. */
  writes: string[];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function memoryAppData(): MemoryDisk {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const writes: string[] = [];
  let clock = 1_700_000_000_000;

  const parentOf = (path: string): string => {
    const slash = path.lastIndexOf("/");
    return slash === -1 ? "" : path.slice(0, slash);
  };

  const requireParent = (path: string): void => {
    const parent = parentOf(path);
    if (parent !== "" && !dirs.has(parent)) throw new Error(`no such directory: ${parent}`);
  };

  const childrenOf = (path: string): string[] => {
    const prefix = path === "" ? "" : `${path}/`;
    const seen = new Set<string>();
    for (const key of [...files.keys(), ...dirs]) {
      if (key === path || !key.startsWith(prefix)) continue;
      const head = key.slice(prefix.length).split("/")[0];
      if (head) seen.add(head);
    }
    return [...seen];
  };

  const disk: MemoryDisk = {
    files,
    dirs,
    writes,

    async exists(path) {
      return files.has(path) || dirs.has(path);
    },

    async readText(path) {
      const bytes = files.get(path);
      if (!bytes) throw new Error(`no such file: ${path}`);
      return decoder.decode(bytes);
    },

    async readBytes(path) {
      const bytes = files.get(path);
      if (!bytes) throw new Error(`no such file: ${path}`);
      return bytes;
    },

    async writeBytes(path, bytes) {
      requireParent(path);
      files.set(path, bytes);
      writes.push(path);
    },

    async appendText(path, text) {
      requireParent(path);
      const before = files.get(path);
      const after = before ? `${decoder.decode(before)}${text}` : text;
      files.set(path, encoder.encode(after));
      writes.push(path);
    },

    async readDir(path) {
      if (!dirs.has(path)) throw new Error(`not a directory: ${path}`);
      return childrenOf(path).map((name): DirEntry => {
        const full = path === "" ? name : `${path}/${name}`;
        const isDirectory = dirs.has(full);
        return { name, isFile: !isDirectory, isDirectory, isSymlink: false };
      });
    },

    async mkdirp(path) {
      const parts = path.split("/").filter(Boolean);
      let acc = "";
      for (const part of parts) {
        acc = acc === "" ? part : `${acc}/${part}`;
        dirs.add(acc);
      }
    },

    async stat(path): Promise<FileInfo | null> {
      const bytes = files.get(path);
      if (bytes) return { mtimeMs: clock++, size: bytes.byteLength };
      if (dirs.has(path)) return { mtimeMs: clock++, size: 0 };
      return null;
    },

    async remove(path) {
      if (files.delete(path)) return;
      if (!dirs.has(path)) throw new Error(`no such file: ${path}`);
      if (childrenOf(path).length > 0) throw new Error(`directory not empty: ${path}`);
      dirs.delete(path);
    },

    async removeDir(path) {
      if (!dirs.has(path)) throw new Error(`no such directory: ${path}`);
      const prefix = `${path}/`;
      for (const key of [...files.keys()]) if (key.startsWith(prefix)) files.delete(key);
      for (const key of [...dirs]) if (key.startsWith(prefix)) dirs.delete(key);
      dirs.delete(path);
    },

    async rename(from, to) {
      const bytes = files.get(from);
      if (bytes) {
        requireParent(to);
        files.delete(from);
        files.set(to, bytes);
        return;
      }
      if (!dirs.has(from)) throw new Error(`no such file: ${from}`);
      const prefix = `${from}/`;
      for (const key of [...files.keys()]) {
        if (!key.startsWith(prefix)) continue;
        files.set(`${to}/${key.slice(prefix.length)}`, files.get(key)!);
        files.delete(key);
      }
      for (const key of [...dirs]) {
        if (!key.startsWith(prefix)) continue;
        dirs.add(`${to}/${key.slice(prefix.length)}`);
        dirs.delete(key);
      }
      dirs.delete(from);
      dirs.add(to);
    },

    async writeAtomic(path, contents) {
      await disk.mkdirp(parentOf(path));
      files.set(path, encoder.encode(contents));
      writes.push(path);
    },

    async quarantine() {
      throw new Error("quarantine is not part of the session store");
    },

    async readPicked() {
      throw new Error("readPicked is not part of the session store");
    },
  };

  return disk;
}
