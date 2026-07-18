// Path-hash -> book-id migration (src/migrate.ts) over a fake fs. Covers the
// move-if-absent guard (idempotency), the shared reading-state map edit, per-book
// file renames, and the prep directory move + surveyHash rewrite. Run: bun test.

import { expect, test } from "bun:test";
import {
  migrateBook,
  migrateNamedFile,
  migratePrepDir,
  migrateViewState,
  type MigrateFs,
} from "../src/migrate";

function makeFakeFs(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  const fs: MigrateFs = {
    async exists(name) {
      if (files.has(name)) return true;
      const prefix = name.endsWith("/") ? name : name + "/";
      for (const k of files.keys()) if (k.startsWith(prefix)) return true;
      return false;
    },
    async readText(name) {
      const v = files.get(name);
      if (v === undefined) throw new Error("ENOENT " + name);
      return v;
    },
    async writeText(name, content) {
      files.set(name, content);
    },
    async rename(from, to) {
      if (files.has(from)) {
        files.set(to, files.get(from)!);
        files.delete(from);
        return;
      }
      const prefix = from + "/";
      for (const k of [...files.keys()]) {
        if (k.startsWith(prefix)) {
          files.set(to + "/" + k.slice(prefix.length), files.get(k)!);
          files.delete(k);
        }
      }
    },
  };
  return { fs, files };
}

test("migrateViewState moves the entry to the new key", async () => {
  const { fs, files } = makeFakeFs({
    "reading-state.json": JSON.stringify({ states: { old: { pageIndex: 4 }, other: { pageIndex: 1 } } }),
  });
  await migrateViewState(fs, "old", "new");
  const store = JSON.parse(files.get("reading-state.json")!);
  expect(store.states.new).toEqual({ pageIndex: 4 });
  expect(store.states.old).toBeUndefined();
  expect(store.states.other).toEqual({ pageIndex: 1 });
});

test("migrateViewState leaves an existing target untouched", async () => {
  const { fs, files } = makeFakeFs({
    "reading-state.json": JSON.stringify({ states: { old: { pageIndex: 4 }, new: { pageIndex: 9 } } }),
  });
  await migrateViewState(fs, "old", "new");
  const store = JSON.parse(files.get("reading-state.json")!);
  // Last-writer-wins is the app's job; migration never clobbers newer data.
  expect(store.states.new).toEqual({ pageIndex: 9 });
  expect(store.states.old).toEqual({ pageIndex: 4 });
});

test("migrateNamedFile renames a per-book file only when the target is absent", async () => {
  const { fs, files } = makeFakeFs({ "annotations-old.json": "[1]" });
  await migrateNamedFile(fs, "annotations", "old", "new");
  expect(files.has("annotations-old.json")).toBe(false);
  expect(files.get("annotations-new.json")).toBe("[1]");

  // A second run is a no-op (source already gone).
  await migrateNamedFile(fs, "annotations", "old", "new");
  expect(files.get("annotations-new.json")).toBe("[1]");
});

test("migrateNamedFile does not overwrite an existing target", async () => {
  const { fs, files } = makeFakeFs({
    "threads-old.json": "OLD",
    "threads-new.json": "NEW",
  });
  await migrateNamedFile(fs, "threads", "old", "new");
  expect(files.get("threads-new.json")).toBe("NEW");
  expect(files.get("threads-old.json")).toBe("OLD");
});

test("migratePrepDir moves the whole directory and rewrites surveyHash", async () => {
  const { fs, files } = makeFakeFs({
    "prep-old/state.json": JSON.stringify({ surveyHash: "old", planStatus: "done" }),
    "prep-old/paper-1.md": "note body",
    "prep-old/pdf/paper-1.pdf": "PDFBYTES",
  });
  await migratePrepDir(fs, "old", "new");
  expect(files.has("prep-old/state.json")).toBe(false);
  expect(files.get("prep-new/paper-1.md")).toBe("note body");
  expect(files.get("prep-new/pdf/paper-1.pdf")).toBe("PDFBYTES");
  const state = JSON.parse(files.get("prep-new/state.json")!);
  expect(state.surveyHash).toBe("new");
  expect(state.planStatus).toBe("done");
});

test("migrateBook is idempotent across a re-run and same-key no-op", async () => {
  const initial = {
    "reading-state.json": JSON.stringify({ states: { old: { pageIndex: 2 } } }),
    "annotations-old.json": "[]",
    "threads-old.json": "{}",
    "prep-old/state.json": JSON.stringify({ surveyHash: "old" }),
  };
  const { fs, files } = makeFakeFs(initial);

  await migrateBook(fs, "old", "new");
  const snapshot = JSON.stringify([...files.entries()].sort());

  // Re-running changes nothing.
  await migrateBook(fs, "old", "new");
  expect(JSON.stringify([...files.entries()].sort())).toBe(snapshot);

  // Same-key migration is a no-op.
  await migrateBook(fs, "new", "new");
  expect(JSON.stringify([...files.entries()].sort())).toBe(snapshot);

  expect(JSON.parse(files.get("reading-state.json")!).states.new).toEqual({ pageIndex: 2 });
  expect(files.get("annotations-new.json")).toBe("[]");
  expect(files.get("threads-new.json")).toBe("{}");
  expect(JSON.parse(files.get("prep-new/state.json")!).surveyHash).toBe("new");
});
