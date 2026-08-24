// The full export surface of the three host packages tests replace with
// mock.module, as an empty disk on a host that answers nothing.
//
// mock.module registers a module for the whole process and never rolls back
// (docs/pitfall/119), so a stub carrying fewer exports than the real module
// does not only mislead the file that wrote it. Any module loaded afterwards
// that imports one of the missing names fails to link with "Export named 'x'
// not found", and the test file that imported *it* does not run at all — while
// bun still counts that file in "Ran N tests across M files". The loss is
// invisible unless the per-file totals are summed and compared against the
// single-process total.
//
// So a stub is completed to the real module's surface, not to the names src
// happens to import today. Each function here returns every export the real
// module has; a test file spreads one and puts its own keys after it, so the
// file's own behaviour always wins and only the names it never thought about
// come from here:
//
//   mock.module("@tauri-apps/plugin-fs", () => ({
//     ...pluginFsSurface(),
//     readTextFile: async (path: string) => ...,
//   }));
//
// Nothing here reaches a host. Reads report no file, writes are swallowed,
// exists is false, invoke throws. A test that means to observe any of that
// overrides the name.

/** Reads answer the way the plugin does for a path that is not there. */
function noFile(path?: unknown): never {
  throw new Error(typeof path === "string" ? `no file: ${path}` : "no file");
}

/**
 * `@tauri-apps/plugin-fs`, all 24 exports. src imports 11 of them
 * (BaseDirectory, exists, mkdir, readDir, readFile, readTextFile, remove,
 * rename, stat, writeFile, writeTextFile); the other 13 are here because the
 * count that matters is the real module's, not today's usage.
 */
export function pluginFsSurface(): Record<string, unknown> {
  return {
    // The real numbering, so a stub that does not override it still maps
    // AppData to what the plugin means by it.
    BaseDirectory: {
      Audio: 1,
      Cache: 2,
      Config: 3,
      Data: 4,
      LocalData: 5,
      Document: 6,
      Download: 7,
      Picture: 8,
      Public: 9,
      Video: 10,
      Resource: 11,
      Temp: 12,
      AppConfig: 13,
      AppData: 14,
      AppLocalData: 15,
      AppCache: 16,
      AppLog: 17,
      Desktop: 18,
      Executable: 19,
      Font: 20,
      Home: 21,
      Runtime: 22,
      Template: 23,
    },
    SeekMode: { Start: 0, Current: 1, End: 2 },
    FileHandle: class FileHandle {
      close(): Promise<void> {
        return Promise.resolve();
      }
    },

    // Reads: nothing is there.
    exists: async () => false,
    readDir: async () => [],
    readFile: async (path?: unknown) => noFile(path),
    readTextFile: async (path?: unknown) => noFile(path),
    readTextFileLines: async () => ({
      [Symbol.asyncIterator]() {
        return { next: async () => ({ done: true as const, value: undefined }) };
      },
    }),
    // stat and lstat throw on the real plugin when the file is not there; the
    // "missing is null" reading belongs to the port, not to this stub.
    stat: async (path?: unknown) => noFile(path),
    lstat: async (path?: unknown) => noFile(path),
    size: async (path?: unknown) => noFile(path),
    open: async (path?: unknown) => noFile(path),
    create: async (path?: unknown) => noFile(path),

    // Writes: accepted and dropped.
    mkdir: async () => {},
    remove: async () => {},
    rename: async () => {},
    copyFile: async () => {},
    truncate: async () => {},
    writeFile: async () => {},
    writeTextFile: async () => {},

    // Watchers and the iOS security-scoped bookmarks: no-ops that unwind.
    watch: async () => () => {},
    watchImmediate: async () => () => {},
    startAccessingSecurityScopedResource: async () => false,
    stopAccessingSecurityScopedResource: async () => {},
  };
}

/**
 * `@tauri-apps/api/core`, all 11 exports. src imports three values from it
 * (invoke, convertFileSrc, addPluginListener) plus the PluginListener type.
 */
export function apiCoreSurface(): Record<string, unknown> {
  return {
    SERIALIZE_TO_IPC_FN: "__TAURI_TO_IPC_KEY__",
    Channel: class Channel {
      onmessage: (message: unknown) => void = () => {};
      toJSON(): string {
        return "__CHANNEL__:0";
      }
    },
    PluginListener: class PluginListener {
      unregister(): Promise<void> {
        return Promise.resolve();
      }
    },
    Resource: class Resource {
      close(): Promise<void> {
        return Promise.resolve();
      }
    },

    invoke: async (command?: unknown) => {
      throw new Error(`no host: invoke(${String(command)})`);
    },
    // The asset protocol is the identity here: a path handed to an <img> or a
    // fetch in a test is the path the test wrote.
    convertFileSrc: (path: string) => path,
    addPluginListener: async () => ({ unregister: async () => {} }),
    checkPermissions: async () => ({}),
    requestPermissions: async () => ({}),
    isTauri: () => false,
    transformCallback: () => 0,
  };
}

/**
 * `@tauri-apps/plugin-os`, all 9 exports. src imports platform and hostname.
 * The resting values are a headless Linux desktop, which is what the two files
 * that mock this module already leave behind them.
 */
export function pluginOsSurface(): Record<string, unknown> {
  return {
    platform: () => "linux",
    arch: () => "x86_64",
    family: () => "unix",
    type: () => "linux",
    version: () => "0.0.0",
    eol: () => "\n",
    exeExtension: () => "",
    hostname: async () => null,
    locale: async () => null,
  };
}
