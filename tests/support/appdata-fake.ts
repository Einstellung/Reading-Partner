// An in-memory AppData for the store tests, installed with spies rather than
// with mock.module.
//
// Why spies. mock.module rewrites the module registry for the whole process and
// mock.restore() does not undo it (docs/pitfall/119), so a stub a test file
// registers is what every file loaded after it links against. Two files that
// each register their own disk therefore race, and the one that loses reads the
// other's memory — which is why the suite's randomised runs failed in files
// nobody had touched. spyOn replaces one property on a module namespace, the
// importers see the replacement (docs/pitfall/122), and the preload's global
// beforeEach(mock.restore) takes it back down before the next test case
// (docs/pitfall/171). Nothing here registers a restore, for that reason.
//
// Because a spy only lives for one test case, this is called from beforeEach:
//
//   let disk: FakeDisk;
//   beforeEach(() => { disk = installAppData(); });
//
// The two host packages are spied, not src. Everything the app keeps goes
// through src/platform/app/appdata.ts, the only module in src that imports
// @tauri-apps/plugin-fs or calls invoke for a filesystem command, so holding
// those two holds the whole store layer — and the code under test is then the
// real port, the real writeTextAtomic and the real readGuardedJson, including
// the store errors they report.
//
// The disk is deliberately literal: a read of what is not there throws the way
// the plugin throws, a path in `unreadable` exists but will not open, and the
// atomic writer and the quarantine are the two Rust commands under their real
// names and argument names.

import { spyOn } from "bun:test";
import * as core from "@tauri-apps/api/core";
import * as fs from "@tauri-apps/plugin-fs";

export interface FakeDisk {
  /** Text files, by AppData-relative path. */
  files: Map<string, string>;
  /** Binary files, for the stores that keep blobs. */
  blobs: Map<string, Uint8Array>;
  /**
   * Paths that are on disk but whose read throws — a locked file, a bad sector,
   * a sync folder that went away mid-read. `exists` still answers true for
   * them: the file is there, it will not open. That pair is what tells
   * "unreadable" apart from "not there".
   */
  unreadable: Set<string>;
  /** Every read, whatever the path, throws. */
  readFails: boolean;
  /** quarantine_file throws instead of moving the file aside. */
  quarantineFails: boolean;
  /** Modification times for stat, unix ms. A path without one stats as null. */
  mtimes: Map<string, number>;
  /** Paths read, in order, text and binary alike. */
  reads: string[];
  /** Paths written, in order, by any of the three writers. */
  writes: string[];
  /** Renames, as `from -> to`, in order. */
  renames: string[];
}

// Fixed, so a quarantined name can be asserted rather than matched.
export const QUARANTINE_SUFFIX = ".corrupt-1700000000000";

/**
 * Spy @tauri-apps/plugin-fs and @tauri-apps/api/core onto one in-memory disk,
 * and hand it back. Call from beforeEach: the spies are taken down between test
 * cases by tests/support/preload.ts.
 */
export function installAppData(): FakeDisk {
  const disk: FakeDisk = {
    files: new Map<string, string>(),
    blobs: new Map<string, Uint8Array>(),
    unreadable: new Set<string>(),
    readFails: false,
    quarantineFails: false,
    mtimes: new Map<string, number>(),
    reads: [],
    writes: [],
    renames: [],
  };

  const has = (path: string): boolean => disk.files.has(path) || disk.blobs.has(path);

  // A directory exists when something is under it, which is what a real
  // filesystem answers and what a caller about to remove one asks. The disk is
  // flat (see readDir below), so it is read off the keys; the trailing slash is
  // what keeps `exists("rehearsal-1")` from being answered by
  // `rehearsal-1.json`.
  const hasDir = (path: string): boolean => {
    const prefix = `${path}/`;
    for (const key of disk.files.keys()) if (key.startsWith(prefix)) return true;
    for (const key of disk.blobs.keys()) if (key.startsWith(prefix)) return true;
    return false;
  };

  const quarantine = async (path: string): Promise<string | null> => {
    if (disk.quarantineFails) throw new Error("rename failed");
    const body = disk.files.get(path);
    if (body === undefined) return null;
    const renamed = `${path}${QUARANTINE_SUFFIX}`;
    disk.files.set(renamed, body);
    disk.files.delete(path);
    return renamed;
  };

  // Each implementation below is cast to the plugin's own signature. The plugin
  // takes `string | URL` and hands back branded typed arrays; this disk is keyed
  // by the relative strings the port passes it, and one cast at the boundary is
  // cheaper than carrying those shapes through every line.
  const asFs = <K extends keyof typeof fs>(fn: unknown): (typeof fs)[K] => fn as (typeof fs)[K];

  // The AppData root itself is a directory, not a file: `exists("")` is how a
  // caller asks whether the base is there at all.
  spyOn(fs, "exists").mockImplementation(
    asFs<"exists">(async (path: string) => path === "" || has(path) || hasDir(path)),
  );

  spyOn(fs, "mkdir").mockImplementation(async () => {});

  // Flat: every path on the disk, whatever directory was asked for. The stores
  // that list a directory filter the names themselves, and a fake that split
  // paths into a tree would be answering a question none of them asks.
  spyOn(fs, "readDir").mockImplementation(async () =>
    [...disk.files.keys(), ...disk.blobs.keys()].map((name) => ({
      name,
      isFile: true,
      isDirectory: false,
      isSymlink: false,
    })),
  );

  spyOn(fs, "readTextFile").mockImplementation(
    asFs<"readTextFile">(async (path: string) => {
      disk.reads.push(path);
      if (disk.readFails || disk.unreadable.has(path)) throw new Error(`EIO: ${path}`);
      const v = disk.files.get(path);
      if (v === undefined) throw new Error(`no file: ${path}`);
      return v;
    }),
  );

  spyOn(fs, "readFile").mockImplementation(
    asFs<"readFile">(async (path: string) => {
      disk.reads.push(path);
      if (disk.readFails || disk.unreadable.has(path)) throw new Error(`EIO: ${path}`);
      const v = disk.blobs.get(path);
      if (v === undefined) throw new Error(`no file: ${path}`);
      return v;
    }),
  );

  // The append the event log writes with, honoured rather than swallowed: it is
  // the one text write in the app that does not go through the atomic writer.
  spyOn(fs, "writeTextFile").mockImplementation(
    asFs<"writeTextFile">(
      async (path: string, contents: string, options?: { append?: boolean }) => {
        disk.writes.push(path);
        disk.files.set(path, options?.append ? (disk.files.get(path) ?? "") + contents : contents);
      },
    ),
  );

  spyOn(fs, "writeFile").mockImplementation(
    asFs<"writeFile">(async (path: string, bytes: Uint8Array) => {
      disk.writes.push(path);
      disk.blobs.set(path, bytes);
    }),
  );

  spyOn(fs, "remove").mockImplementation(
    asFs<"remove">(async (path: string, options?: { recursive?: boolean }) => {
      if (!options?.recursive) {
        disk.files.delete(path);
        disk.blobs.delete(path);
        return;
      }
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const under = (key: string): boolean => key === path || key.startsWith(prefix);
      for (const key of [...disk.files.keys()]) if (under(key)) disk.files.delete(key);
      for (const key of [...disk.blobs.keys()]) if (under(key)) disk.blobs.delete(key);
    }),
  );

  spyOn(fs, "rename").mockImplementation(
    asFs<"rename">(async (from: string, to: string) => {
      const text = disk.files.get(from);
      const bytes = disk.blobs.get(from);
      if (text === undefined && bytes === undefined) throw new Error(`no file: ${from}`);
      if (text !== undefined) {
        disk.files.set(to, text);
        disk.files.delete(from);
      }
      if (bytes !== undefined) {
        disk.blobs.set(to, bytes);
        disk.blobs.delete(from);
      }
      disk.renames.push(`${from} -> ${to}`);
    }),
  );

  // Throws for a file that is not there, the way the plugin does. "Missing is
  // null" is the port's reading of that, and belongs to the port.
  spyOn(fs, "stat").mockImplementation(
    asFs<"stat">(async (path: string) => {
      if (!has(path)) throw new Error(`no file: ${path}`);
      const mtime = disk.mtimes.get(path);
      const size = disk.files.has(path)
        ? new TextEncoder().encode(disk.files.get(path) ?? "").byteLength
        : (disk.blobs.get(path)?.byteLength ?? 0);
      return { mtime: mtime === undefined ? null : new Date(mtime), size };
    }),
  );

  // The two Rust commands behind src-tauri/src/atomic_fs.rs, under the argument
  // names tests/platform/app/appdata-contract.test.ts pins.
  spyOn(core, "invoke").mockImplementation((async (
    command: string,
    args?: { path?: string; contents?: string },
  ) => {
    const path = args?.path ?? "";
    if (command === "write_text_file_atomic") {
      disk.writes.push(path);
      disk.files.set(path, args?.contents ?? "");
      return null;
    }
    if (command === "quarantine_file") return await quarantine(path);
    throw new Error(`unexpected command ${command}`);
  }) as typeof core.invoke);

  // An asset URL a test can see through: what an <img> is handed is the path
  // the test wrote.
  spyOn(core, "convertFileSrc").mockImplementation((path: string) => path);

  return disk;
}
