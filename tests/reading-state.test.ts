// Reading positions over their file (src/platform/app/storage.ts). The pure mode
// merge is in storage.test.ts; this is the half that touches disk.
//
// One file holds every book's position and every save rewrites all of it, so a
// read that failed used to become "this device has one book" the moment the user
// scrolled — and reading-state.json is in sync range, so that goes out to the
// other device too.
//
// The way out of the app is the other half. pagehide suspends the webview with no
// second chance, so the exit path spends one IPC rather than two, and a read that
// fails there must not turn into writing nothing at all: that would lose the last
// position of the session, which is the reason the exit path exists (docs/13).
//
// Run: bun test.

import { beforeEach, expect, mock, test } from "bun:test";
// Type-only, so it is erased and never loads the module before mock.module runs.
import type { ViewState } from "../src/platform/app/reader-contract";

const files = new Map<string, string>();
let readFails = false;
let quarantineFails = false;
let reads = 0;

mock.module("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async (path: string) => files.has(path),
  mkdir: async () => {},
  readDir: async () => [],
  readTextFile: async (path: string) => {
    reads++;
    if (readFails) throw new Error("EIO");
    const v = files.get(path);
    if (v === undefined) throw new Error(`no file: ${path}`);
    return v;
  },
  writeTextFile: async (path: string, content: string) => {
    files.set(path, content);
  },
  // Only so importing syncFs.ts resolves; nothing here reaches them. Its write
  // takes the atomic-writer branch for the UTF-8 text every in-range file is.
  readFile: async () => new Uint8Array(),
  stat: async () => ({ mtime: null, size: 0 }),
  writeFile: async () => {},
}));

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: { path: string; contents?: string }) => {
    if (cmd === "write_text_file_atomic") {
      files.set(args.path, args.contents ?? "");
      return null;
    }
    if (cmd === "quarantine_file") {
      if (quarantineFails) throw new Error("rename failed");
      const body = files.get(args.path);
      if (body === undefined) return null;
      const renamed = `${args.path}.corrupt-1700000000000`;
      files.set(renamed, body);
      files.delete(args.path);
      return renamed;
    }
    throw new Error(`unexpected command ${cmd}`);
  },
}));

const { STATE_FILE, dropViewStateCache, getViewState, saveViewState, saveViewStateOnExit } =
  await import("../src/platform/app/storage");
// The door every other writer of this file goes through, and the one sync's own
// writes land on (syncFs.write).
const { writeTextAtomic } = await import("../src/platform/app/atomic-fs");
const { tauriSyncFs } = await import("../src/platform/sync/syncFs");

const at = (pageIndex: number): ViewState => ({ pageIndex, scale: "auto", scrollMode: 0 });

// Three books read on this device, only one of which is open now.
const STATES = {
  states: {
    jit: at(120),
    tracing: at(7),
    attention: at(31),
  },
};

const STATES_JSON = JSON.stringify(STATES, null, 2);
const CORRUPT = "reading-state.json.corrupt-1700000000000";

function onDisk(): { states: Record<string, ViewState> } {
  return JSON.parse(files.get(STATE_FILE)!) as { states: Record<string, ViewState> };
}

beforeEach(() => {
  files.clear();
  files.set(STATE_FILE, STATES_JSON);
  readFails = false;
  quarantineFails = false;
  reads = 0;
  dropViewStateCache();
});

// --- a read that failed for IO reasons --------------------------------------

test("a position saved over an unreadable file is refused, and the file is untouched", async () => {
  readFails = true;
  await expect(saveViewState("jit", at(121))).rejects.toThrow(/could not be read/);

  expect(files.get(STATE_FILE)).toBe(STATES_JSON);
  expect(files.has(CORRUPT)).toBe(false);

  // The two books that were not even open still have their positions.
  readFails = false;
  expect(await getViewState("tracing")).toEqual(at(7));
  expect(await getViewState("attention")).toEqual(at(31));
});

// --- bytes that will not parse ----------------------------------------------

const TRUNCATED = STATES_JSON.slice(0, 40);

test("a truncated file is moved aside rather than written over", async () => {
  files.set(STATE_FILE, TRUNCATED);

  await saveViewState("jit", at(121));

  expect(onDisk().states).toEqual({ jit: at(121) });
  expect(files.get(CORRUPT)).toBe(TRUNCATED);
});

test("bytes that could not be moved aside are not overwritten either", async () => {
  files.set(STATE_FILE, TRUNCATED);
  quarantineFails = true;

  await expect(saveViewState("jit", at(121))).rejects.toThrow(/could not be read/);
  expect(files.get(STATE_FILE)).toBe(TRUNCATED);
});

test("an ordinary save keeps every other book's position", async () => {
  await saveViewState("jit", at(121));
  expect(onDisk().states).toEqual({ jit: at(121), tracing: at(7), attention: at(31) });
});

// --- the way out of the app -------------------------------------------------

// A session that has already written once holds the map, so the exit write is
// the write and nothing else.
test("the exit path writes without reading the file again", async () => {
  await saveViewState("jit", at(121));
  const before = reads;

  await saveViewStateOnExit("jit", at(140));

  expect(reads).toBe(before);
  expect(onDisk().states).toEqual({ jit: at(140), tracing: at(7), attention: at(31) });
});

// Opening a book reads this file, and a read reconciles as well as a write does.
// So the shortest session there is — open, scroll once, quit inside the debounce
// — still goes out in one IPC.
test("a read primes the exit path, so a session's first write is one IPC too", async () => {
  expect(await getViewState("jit")).toEqual(at(120));
  const before = reads;

  await saveViewStateOnExit("jit", at(140));

  expect(reads).toBe(before);
  expect(onDisk().states).toEqual({ jit: at(140), tracing: at(7), attention: at(31) });
});

// Nothing has been read yet, so there is nothing to write from: this one reads
// first, and what it must never do is write the one book on its own.
test("an exit before anything was read falls back to reading, and refuses a bad read", async () => {
  readFails = true;
  await expect(saveViewStateOnExit("jit", at(140))).rejects.toThrow(/could not be read/);
  expect(files.get(STATE_FILE)).toBe(STATES_JSON);

  readFails = false;
  await saveViewStateOnExit("jit", at(140));
  expect(onDisk().states).toEqual({ jit: at(140), tracing: at(7), attention: at(31) });
});

// What the pull route is for: another device's positions landed while this one
// was running, so the map this session holds is no longer the file.
test("a pull drops the held map, so the exit write does not undo it", async () => {
  await saveViewState("jit", at(121));

  // The pull lands, with a book this device has never opened in it.
  files.set(
    STATE_FILE,
    JSON.stringify({ states: { ...STATES.states, jit: at(121), ipad: at(5) } }, null, 2),
  );
  dropViewStateCache();

  await saveViewStateOnExit("jit", at(140));

  expect(onDisk().states).toEqual({
    jit: at(140),
    tracing: at(7),
    attention: at(31),
    ipad: at(5),
  });
});

// --- somebody else wrote the file -------------------------------------------

// A sync pass writes reading-state.json in the middle of itself and tells the
// pull routes at the end, after the remaining merges, every upload, the base
// seeding and the books channel — and tells them nothing at all if it throws
// first. So the held map is dropped by the write, not by the news of it.
test("a write by anything else drops the held map, with no pull route involved", async () => {
  // Opening a book primes the map, which is the case the exit path exists for.
  expect(await getViewState("jit")).toEqual(at(120));

  // What a merge leaves behind: this device's three books plus the iPad's.
  await writeTextAtomic(
    STATE_FILE,
    JSON.stringify({ states: { ...STATES.states, ipad: at(5) } }, null, 2),
  );

  await saveViewStateOnExit("jit", at(140));

  expect(onDisk().states).toEqual({
    jit: at(140),
    tracing: at(7),
    attention: at(31),
    ipad: at(5),
  });
});

// The same write as sync actually makes it, through the fs surface the engine is
// given rather than through the atomic writer by hand.
test("a merge landing through syncFs drops it too", async () => {
  expect(await getViewState("jit")).toEqual(at(120));

  await tauriSyncFs.write(
    STATE_FILE,
    new TextEncoder().encode(
      JSON.stringify({ states: { ...STATES.states, ipad: at(5) } }, null, 2),
    ),
  );

  await saveViewStateOnExit("jit", at(140));
  expect(Object.keys(onDisk().states).sort()).toEqual([
    "attention",
    "ipad",
    "jit",
    "tracing",
  ]);
});

// The drop is by name. Another store saving is not a reason to spend the second
// IPC at pagehide, which is the whole point of holding the map.
test("another file being written leaves the held map alone", async () => {
  await saveViewState("jit", at(121));
  const before = reads;

  await writeTextAtomic("topics.json", JSON.stringify({ topics: [] }, null, 2));
  await saveViewStateOnExit("jit", at(140));

  expect(reads).toBe(before);
  expect(onDisk().states).toEqual({ jit: at(140), tracing: at(7), attention: at(31) });
});
