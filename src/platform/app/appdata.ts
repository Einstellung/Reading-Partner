// The filesystem, as one door. Everything the app keeps lives under AppData,
// and this is the only module in src that imports @tauri-apps/plugin-fs or
// calls invoke for a filesystem command. src/smoke/* is the one exemption: a
// bench script writes its journal wherever it likes.
//
// Two things the door buys that 120 scattered plugin calls did not.
//
// The base directory is said once. Every read and write below carries
// { baseDir: BaseDirectory.AppData }; a caller passes a relative path and
// nothing else. Before this, that argument was repeated at every call site and
// no test ever checked it — the fs stubs all ignore their second argument, so
// an omission would have reached a device before it reached a test. Now it is
// one line, and tests/platform/app/appdata.test.ts asserts it.
//
// The plugin's types stop at this line. readDir hands back the port's own
// DirEntry and stat the port's own FileInfo, with the plugin's `mtime: Date |
// null` already flattened to a number, so a caller never imports a type from a
// host package to describe its own data.
//
// stat is where the two surfaces disagree on purpose. The plugin throws for a
// file that is not there; here that is null, because every caller wants the
// same three-line try/catch. A caller must therefore test the result — see
// platform/sync/syncFs.ts, where dereferencing the null would have been
// swallowed by an enclosing catch and quietly emptied the scan.

import { invoke } from "@tauri-apps/api/core";
import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  rename,
  stat,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

// The base every path below is resolved against, read per call rather than
// frozen into a module constant. BaseDirectory is a numbering the plugin owns,
// and a constant would keep whichever instance of the plugin was loaded when
// this module was evaluated — which, once something has re-registered that
// module (docs/pitfall/119), is not the instance the calls below land on.
const base = () => ({ baseDir: BaseDirectory.AppData });

/** One entry of a directory listing. The port's own type, not the plugin's. */
export interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

/**
 * What a stat says about a file. `mtimeMs` is unix milliseconds, and 0 on the
 * platforms that do not report a modification time — the plugin's `Date | null`
 * flattened here so no caller has to.
 */
export interface FileInfo {
  mtimeMs: number;
  size: number;
}

export interface AppDataFs {
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  appendText(path: string, text: string): Promise<void>;
  readDir(path: string): Promise<DirEntry[]>;
  mkdirp(path: string): Promise<void>;
  stat(path: string): Promise<FileInfo | null>;
  remove(path: string): Promise<void>;
  removeDir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  writeAtomic(path: string, contents: string): Promise<void>;
  quarantine(path: string): Promise<string | null>;
  readPicked(absolutePath: string): Promise<Uint8Array>;
}

// Who to tell when a path stops holding what it held, by something other than a
// write. Writes are announced one layer up, by atomic-fs.ts, which is where the
// policy that routes them lives; the four operations below are this door's own
// and nothing above sees any of them. The sync engine listens to both feeds so
// that a local edit no longer has to be found by re-scanning the whole sync
// range every fifteen seconds (platform/sync/engine.ts).
const pathListeners = new Set<(path: string) => void>();

/**
 * Hear about every AppData path this door changed other than by writing to it:
 * remove(), removeDir() (the directory itself — the files under it are never
 * named), both ends of a rename(), and quarantine(). By relative path, after
 * the operation succeeded. Returns the undo.
 */
export function onPathChanged(listener: (path: string) => void): () => void {
  pathListeners.add(listener);
  return () => {
    pathListeners.delete(listener);
  };
}

// A listener exists to invalidate something; one that throws must not turn an
// operation that happened into one that failed.
function announce(path: string): void {
  for (const listener of [...pathListeners]) {
    try {
      listener(path);
    } catch (e) {
      console.error(`path listener failed for ${path}`, e);
    }
  }
}

/**
 * AppData, as the app addresses it: relative paths, no base directory, no
 * options objects. One object rather than fourteen exports so a test can spy a
 * single method on it and every caller sees the replacement.
 */
export const appData: AppDataFs = {
  exists(path) {
    return exists(path, base());
  },

  readText(path) {
    return readTextFile(path, base());
  },

  readBytes(path) {
    return readFile(path, base());
  },

  writeBytes(path, bytes) {
    return writeFile(path, bytes, base());
  },

  // The one write that is not atomic, and the only one that may not be: an
  // O_APPEND of a single short line is already all-or-nothing, while the atomic
  // writer would rewrite the whole log to add to it (platform/app/events.ts).
  appendText(path, text) {
    return writeTextFile(path, text, { ...base(), append: true });
  },

  async readDir(path) {
    const entries = await readDir(path, base());
    return entries.map((e) => ({
      name: e.name,
      isFile: e.isFile,
      isDirectory: e.isDirectory,
      isSymlink: e.isSymlink,
    }));
  },

  // Recursive, always: every caller was already spreading `recursive: true`,
  // and a mkdir of one segment whose parent is missing is nobody's intent.
  mkdirp(path) {
    return mkdir(path, { ...base(), recursive: true });
  },

  // Null rather than a throw. A file that is not there, and a file the host
  // refuses to stat, are the same answer to every caller in this app: there is
  // nothing to compare against.
  async stat(path) {
    try {
      const info = await stat(path, base());
      return { mtimeMs: info.mtime ? info.mtime.getTime() : 0, size: info.size };
    } catch {
      return null;
    }
  },

  async remove(path) {
    await remove(path, base());
    announce(path);
  },

  async removeDir(path) {
    await remove(path, { ...base(), recursive: true });
    // The directory, not what was in it: this call never learns the names, and
    // a listener that cares about a file under it has to sweep for itself.
    announce(path);
  },

  async rename(from, to) {
    await rename(from, to, {
      oldPathBaseDir: BaseDirectory.AppData,
      newPathBaseDir: BaseDirectory.AppData,
    });
    // Both ends. The file left one path and appeared at the other, and neither
    // half is a write that anything else announces — which is how
    // annotations-<key>.json moves during the key migration (migrate.ts).
    announce(from);
    announce(to);
  },

  // Temp file, fsync, rename, in Rust (src-tauri/src/atomic_fs.rs), so a process
  // death mid-write cannot leave half a file behind. The argument names are the
  // Rust command's parameter names and are pinned by
  // tests/platform/app/appdata-contract.test.ts.
  async writeAtomic(path, contents) {
    await invoke("write_text_file_atomic", { path, contents });
  },

  // Move an unreadable file aside as `<name>.corrupt-<unix-ms>`, returning the
  // new name or null when there was nothing to move. Only the path that was
  // emptied is announced; where the bad bytes went is a name nothing syncs and
  // no store holds a copy of.
  async quarantine(path) {
    const savedAs = await invoke<string | null>("quarantine_file", { path });
    if (savedAs !== null) announce(path);
    return savedAs;
  },

  // The one read that is not AppData-relative: an absolute path the reader
  // chose in a file picker. Without it every domain that opens a picked file
  // would need its own licence to talk to the plugin.
  readPicked(absolutePath) {
    return readFile(absolutePath);
  },
};
