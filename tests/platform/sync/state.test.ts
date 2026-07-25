// Sync's local bookkeeping (src/platform/sync/state.ts). What matters here is the
// fallback: loadState swallows every read failure and returns an empty state, so
// these pin what "empty" costs — the Drive ids and the snapshot are rebuildable
// (the backend searches by name before creating, and reconcile falls back to
// comparing mtimes), while the autoSync toggle is not, and quietly reverts to
// off. The fs plugin is in-memory. Run: bun test.

import { expect, mock, test } from "bun:test";

let file: string | null = null;
let readFails = false;

mock.module("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async () => file !== null,
  readTextFile: async () => {
    if (readFails) throw new Error("EIO");
    if (file === null) throw new Error("no file");
    return file;
  },
}));

const { emptyState, loadState } = await import("../../../src/platform/sync/state");

test("a first run with no state file loads the defaults", async () => {
  file = null;
  readFails = false;
  expect(await loadState()).toEqual(emptyState());
});

test("an unreadable or corrupt state file falls back to defaults instead of failing startup", async () => {
  file = "{ this is not json";
  readFails = false;
  expect(await loadState()).toEqual(emptyState());

  file = "{}";
  readFails = true;
  const s = await loadState();
  readFails = false;
  expect(s.snapshot).toEqual({});
  expect(s.drive).toEqual({ fileIds: {}, bookIds: {} });
  // The one thing the fallback cannot rebuild: auto-sync goes quiet until the
  // user notices and turns it back on.
  expect(s.autoSync).toBe(false);
});

test("a state file written by an older version keeps its values and fills the missing maps", async () => {
  readFails = false;
  file = JSON.stringify({
    autoSync: true,
    snapshot: { "settings.json": { rev: 3, mtime: 10, size: 2 } },
    drive: { folderId: "f1", dataFolderId: "d1", fileIds: { "settings.json": "x1" } },
  });

  const s = await loadState();

  expect(s.autoSync).toBe(true);
  expect(s.snapshot).toEqual({ "settings.json": { rev: 3, mtime: 10, size: 2 } });
  expect(s.drive.folderId).toBe("f1");
  expect(s.drive.fileIds).toEqual({ "settings.json": "x1" });
  // Absent in the old shape. Left undefined it would throw on the first book
  // lookup, mid-sync, with the pass already half done.
  expect(s.drive.bookIds).toEqual({});
  expect(s.lastError).toBeNull();
});

// saveState is one writeTextAtomic of JSON.stringify(state), so this is the
// round trip: what it writes must load back unchanged.
test("a complete state file loads back exactly as written", async () => {
  readFails = false;
  const state = emptyState();
  state.autoSync = true;
  state.drive.folderId = "f1";
  state.drive.booksFolderId = "b1";
  state.drive.bookIds = { abc: "book-1" };
  state.snapshot = { "topics.json": { rev: 7, mtime: 40, size: 9 } };
  file = JSON.stringify(state, null, 2);

  // Dropping any of this on the way back in is what makes the next pass
  // re-adopt, or re-create, every remote file.
  expect(await loadState()).toEqual(state);
});
