// Sync's local bookkeeping (src/platform/sync/state.ts). What matters here is the
// fallback: loadState swallows every read failure and returns an empty state, so
// these pin what "empty" costs — the Drive ids and the snapshot are rebuildable
// (the backend searches by name before creating, and reconcile falls back to
// comparing mtimes), while the autoSync toggle is not, and quietly reverts to
// off. Also recordPassResult, the one path by which a pass result reaches the
// file. The fs plugin is in-memory. Run: bun test.

import { expect, mock, test } from "bun:test";
import { pluginFsSurface } from "../../support/stub-surface";

let file: string | null = null;
let readFails = false;

// The surface spread first is the whole plugin; the two keys below are this
// file's disk and win over it — readFails included, which is what these tests
// are about. mock.module is process-wide, so a name missing here would break
// whichever file loads next (docs/pitfall/119).
mock.module("@tauri-apps/plugin-fs", () => ({
  ...pluginFsSurface(),
  BaseDirectory: { AppData: 1 },
  exists: async () => file !== null,
  readTextFile: async () => {
    if (readFails) throw new Error("EIO");
    if (file === null) throw new Error("no file");
    return file;
  },
}));

const { emptyState, loadState, recordPassResult } = await import(
  "../../../src/platform/sync/state"
);

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

// recordPassResult is the only way a pass result reaches the file. lastSyncAt
// is the one field it will not take a null for: the emit runPass makes before
// it has done any work carries one, and writing it through is what showed
// "Last sync: Never" on a device that syncs fine.
test("a status emit without a timestamp leaves the recorded one alone", () => {
  const state = emptyState();
  state.lastSyncAt = 1234;

  recordPassResult(state, { lastSyncAt: null, lastError: null });

  expect(state.lastSyncAt).toBe(1234);
});

test("a status emit with a timestamp records it, and its error either way", () => {
  const state = emptyState();
  state.lastSyncAt = 1234;

  recordPassResult(state, { lastSyncAt: 5678, lastError: "upload a.json failed: offline" });
  expect(state.lastSyncAt).toBe(5678);
  expect(state.lastError).toBe("upload a.json failed: offline");

  // A null error is a real value — the pass that clears it has to be able to.
  recordPassResult(state, { lastSyncAt: null, lastError: null });
  expect(state.lastError).toBeNull();
});
