// An in-memory AppData for the store tests: the fs plugin's surface, the Rust
// atomic writer behind @tauri-apps/api/core, and a stand-in for atomic-fs
// itself. A test file installs them with its own relative specifiers —
// mock.module resolves relative to the file that calls it:
//
//   const app = makeAppData();
//   mock.module("@tauri-apps/plugin-fs", () => app.pluginFs);
//   mock.module("@tauri-apps/api/core", () => app.core);
//   mock.module("../../src/platform/app/atomic-fs", () => app.atomicFs);
//
// The third one is here because bun's mock.module is process-wide and the last
// file to load wins: another test file (tests/ai/credential-race.test.ts,
// tests/observation/profile.test.ts) may already have swapped atomic-fs for a
// stub with two exports in it, and everything imported afterwards gets that.
// So a file that needs the whole module has to put a whole one back, and every
// export is here for the same reason — a half-mocked module breaks whichever
// file loads next.
//
// pluginFs and core therefore start from the real modules' full surface
// (tests/support/stub-surface.ts) and the disk below overrides the names it
// answers for. What the disk does not name — rename, the watchers, the handle
// API — resolves to a dead-host no-op rather than to nothing at all.
//
// readGuardedJson mirrors src/platform/app/atomic-fs.ts: missing, ok, or
// corrupt — and corrupt says whether the bad bytes could be moved aside, which
// is what a caller uses to decide it may write. The real one is tested against
// its own mocked plugin in tests/atomic-fs.test.ts; this is the shape callers
// are written against.

import { apiCoreSurface, pluginFsSurface } from "./stub-surface";

export interface FakeAppData {
  /** Text files, by AppData-relative path. */
  files: Map<string, string>;
  /** Binary files, for the stores that keep blobs. */
  blobs: Map<string, Uint8Array>;
  /**
   * Paths whose read throws — an EIO, a decode error, a file something else has
   * open. `exists` still answers true for them: the file is there, it will not
   * open. That pair is what tells "unreadable" apart from "not there".
   */
  unreadable: Set<string>;
  pluginFs: Record<string, unknown>;
  core: Record<string, unknown>;
  atomicFs: Record<string, unknown>;
  /** Empty the disk. For beforeEach. */
  reset(): void;
}

// Fixed so a quarantined name can be asserted.
const QUARANTINE_SUFFIX = ".corrupt-1700000000000";

export function makeAppData(): FakeAppData {
  const files = new Map<string, string>();
  const blobs = new Map<string, Uint8Array>();
  const unreadable = new Set<string>();

  const readText = async (path: string): Promise<string> => {
    if (unreadable.has(path)) throw new Error("EIO");
    const v = files.get(path);
    if (v === undefined) throw new Error(`no file: ${path}`);
    return v;
  };

  const quarantineFile = async (path: string): Promise<string | null> => {
    const body = files.get(path);
    if (body === undefined) return null;
    const renamed = `${path}${QUARANTINE_SUFFIX}`;
    files.set(renamed, body);
    files.delete(path);
    return renamed;
  };

  const pluginFs: Record<string, unknown> = {
    ...pluginFsSurface(),
    BaseDirectory: { AppData: 1 },
    exists: async (path: string) => path === "" || files.has(path) || blobs.has(path),
    mkdir: async () => {},
    readDir: async () =>
      [...files.keys(), ...blobs.keys()].map((name) => ({
        name,
        isFile: true,
        isDirectory: false,
      })),
    readTextFile: readText,
    readFile: async (path: string) => {
      const v = blobs.get(path);
      if (v === undefined) throw new Error(`no file: ${path}`);
      return v;
    },
    stat: async () => {
      throw new Error("no file");
    },
    remove: async (path: string) => {
      files.delete(path);
      blobs.delete(path);
    },
    writeTextFile: async (path: string, body: string) => {
      files.set(path, body);
    },
    writeFile: async (path: string, body: Uint8Array) => {
      blobs.set(path, body);
    },
  };

  const core: Record<string, unknown> = {
    ...apiCoreSurface(),
    invoke: async (cmd: string, args: { path: string; contents?: string }) => {
      if (cmd === "write_text_file_atomic") {
        files.set(args.path, args.contents ?? "");
        return null;
      }
      if (cmd === "quarantine_file") return await quarantineFile(args.path);
      throw new Error(`unexpected command ${cmd}`);
    },
  };

  const readJson = async <T>(file: string, validate?: (raw: unknown) => T | null) => {
    try {
      if (!files.has(file)) return null;
      const raw = JSON.parse(await readText(file)) as unknown;
      return validate ? validate(raw) : (raw as T);
    } catch {
      return null;
    }
  };

  const atomicFs: Record<string, unknown> = {
    APPDATA: { baseDir: 1 },
    writeTextAtomic: async (path: string, contents: string) => {
      files.set(path, contents);
    },
    quarantineFile,
    readGuardedJson: async <T>(file: string, validate: (raw: unknown) => T | null) => {
      if (!files.has(file)) return { status: "missing" };
      let text: string;
      try {
        text = await readText(file);
      } catch {
        // Nothing is known to be wrong with the file itself, so it stays where
        // it is and the caller is told it may not write.
        return { status: "corrupt", savedAs: null };
      }
      try {
        const value = validate(JSON.parse(text) as unknown);
        if (value !== null) return { status: "ok", value };
      } catch {
        // Falls through to the quarantine.
      }
      return { status: "corrupt", savedAs: await quarantineFile(file) };
    },
    readJson,
    readJsonOr: async <T>(file: string, fallback: T, validate?: (raw: unknown) => T | null) => {
      const value = await readJson<T>(file, validate);
      return value ?? structuredClone(fallback);
    },
    readGuardedText: async (file: string) => {
      if (!files.has(file)) return { status: "missing" };
      try {
        return { status: "ok", value: await readText(file) };
      } catch {
        return { status: "corrupt", savedAs: null };
      }
    },
    // Nothing here watches the disk, so the unsubscribe is all a caller needs.
    onFileWritten: () => () => {},
  };

  return {
    files,
    blobs,
    unreadable,
    pluginFs,
    core,
    atomicFs,
    reset() {
      files.clear();
      blobs.clear();
      unreadable.clear();
    },
  };
}
