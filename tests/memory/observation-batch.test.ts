// The two whole-book operations on the observation store: dropping every
// observation of a deleted book in one go, and filing a replaced book's
// observations under the book that took its place.

import { expect, test } from "bun:test";
import { parseTombstones } from "../../src/memory/observations/files";
import { ObservationFileStore, type ObservationFs } from "../../src/memory/observations/store";
import { JULY_17, makeFakeFs } from "./fakefs";

const TOMBSTONES = "observations/deleted-observations.jsonl";

function counting(fs: ObservationFs) {
  const counts = { tombstoneWrites: 0, listDirs: 0 };
  const wrapped: ObservationFs = {
    ...fs,
    write: (path, content) => {
      if (path === TOMBSTONES) counts.tombstoneWrites++;
      return fs.write(path, content);
    },
    listDir: (path) => {
      counts.listDirs++;
      return fs.listDir(path);
    },
  };
  return { wrapped, counts };
}

test("deleteMany tombstones every id with one append and one rebuild", async () => {
  const { fs, files } = makeFakeFs();
  const seed = new ObservationFileStore(fs, () => JULY_17);
  const a = await seed.create({ type: "belief", summary: "a", body: "a", bookId: "b1" });
  const b = await seed.create({ type: "belief", summary: "b", body: "b", bookId: "b1" });
  const keep = await seed.create({ type: "belief", summary: "k", body: "k", bookId: "b2" });

  const { wrapped, counts } = counting(fs);
  const store = new ObservationFileStore(wrapped, () => JULY_17);
  expect(await store.deleteMany([a.id, b.id, "m-0000000000000000"])).toBe(2);

  expect(counts.tombstoneWrites).toBe(1);
  expect(counts.listDirs).toBe(1);
  expect([...parseTombstones(files.get(TOMBSTONES) ?? "")].sort()).toEqual([a.id, b.id].sort());
  expect((await store.list()).map((o) => o.id)).toEqual([keep.id]);
  expect((await store.readIndex()).map((e) => e.id)).toEqual([keep.id]);
  expect(files.has(`observations/${a.id}.md`)).toBe(false);
});

test("deleteMany on ids already tombstoned writes no second line", async () => {
  const { fs, files } = makeFakeFs();
  const store = new ObservationFileStore(fs, () => JULY_17);
  const a = await store.create({ type: "belief", summary: "a", body: "a" });
  await store.delete(a.id);
  const before = files.get(TOMBSTONES);
  expect(await store.deleteMany([a.id])).toBe(1);
  expect(files.get(TOMBSTONES)).toBe(before);
  expect(await store.deleteMany([])).toBe(0);
});

test("moveBook refiles a book's observations and carries its mark cursor", async () => {
  const { fs } = makeFakeFs();
  const store = new ObservationFileStore(fs, () => JULY_17);
  const a = await store.create({ type: "belief", summary: "a", body: "a", bookId: "old" });
  const other = await store.create({ type: "belief", summary: "o", body: "o", bookId: "else" });
  await store.setMeta("t1", {
    lastDistilledAt: 5,
    lastAnnotationDistillAt: null,
    distilledMessages: { thread1: 7 },
    distilledMarks: { old: 42 },
  });

  expect(await store.moveBook("old", "new")).toBe(1);

  const moved = await store.get(a.id);
  expect(moved?.bookId).toBe("new");
  expect(moved?.updated).toBe(a.updated);
  expect((await store.get(other.id))?.bookId).toBe("else");
  const meta = await store.getMeta("t1");
  expect(meta.distilledMarks).toEqual({ old: 42, new: 42 });
  expect(meta.distilledMessages).toEqual({ thread1: 7 });
  expect(meta.lastDistilledAt).toBe(5);
});

test("forgetBooks drops the named books' mark cursors and nothing else", async () => {
  const { fs } = makeFakeFs();
  const store = new ObservationFileStore(fs, () => JULY_17);
  await store.setMeta("t1", {
    lastDistilledAt: 5,
    lastAnnotationDistillAt: 3,
    distilledMessages: { thread1: 7 },
    distilledMessageKeys: { thread1: ["k1"] },
    distilledMarks: { gone: 42, kept: 9 },
  });

  expect(await store.forgetBooks(new Set(["gone", "never-distilled"]))).toBe(true);

  expect(await store.getMeta("t1")).toEqual({
    lastDistilledAt: 5,
    lastAnnotationDistillAt: 3,
    distilledMessages: { thread1: 7 },
    distilledMessageKeys: { thread1: ["k1"] },
    distilledMarks: { kept: 9 },
  });
});

// A rewrite is a sync revision of a file every device holds, so a settle over a
// log whose books have no cursor left writes nothing.
test("forgetBooks does not write when none of the books has a cursor", async () => {
  const { fs, files } = makeFakeFs();
  const store = new ObservationFileStore(fs, () => JULY_17);
  await store.setMeta("t1", { lastDistilledAt: 5, lastAnnotationDistillAt: null, distilledMarks: { kept: 9 } });
  const before = files.get("observations/meta.json");

  expect(await store.forgetBooks(["gone"])).toBe(false);
  expect(files.get("observations/meta.json")).toBe(before);

  const empty = makeFakeFs();
  expect(await new ObservationFileStore(empty.fs).forgetBooks(["gone"])).toBe(false);
  expect(empty.files.size).toBe(0);
});
