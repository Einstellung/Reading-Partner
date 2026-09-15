// A book's supplement list (src/platform/app/supplements.ts): the real store,
// its serialisation included, run against a file in memory.
// Run: bash scripts/t.sh tests/platform/app/supplements.test.ts

import { expect, test } from "bun:test";
import {
  createSupplementStore,
  supplementsFile,
  type SupplementFile,
  type SupplementIo,
  type SupplementRef,
} from "../../../src/platform/app/supplements";
import type { GuardedRead } from "../../../src/platform/app/atomic-fs";

const BOOK = "aaaa1111";

function ref(over: Partial<SupplementRef> = {}): SupplementRef {
  return {
    hash: "cccc3333",
    title: "How a web page becomes a book",
    sourceUrl: "https://example.com/posts/how",
    addedAt: 1_700_000_000_000,
    ...over,
  };
}

interface Disk {
  io: SupplementIo;
  files: Map<string, string>;
  writes: string[];
}

function disk(seed: Record<string, string> = {}, over: Partial<SupplementIo> = {}): Disk {
  const files = new Map(Object.entries(seed));
  const writes: string[] = [];
  return {
    files,
    writes,
    io: {
      read: async (file): Promise<GuardedRead<SupplementFile>> => {
        const text = files.get(file);
        if (text === undefined) return { status: "missing" };
        const parsed = JSON.parse(text) as SupplementFile;
        return { status: "ok", value: parsed };
      },
      write: async (file, contents) => {
        writes.push(file);
        files.set(file, contents);
      },
      ...over,
    },
  };
}

test("a book with no file has no supplements, and nothing is written to say so", async () => {
  const d = disk();
  const store = createSupplementStore(d.io);
  expect(await store.list(BOOK)).toEqual([]);
  expect(d.writes).toEqual([]);
});

test("an added supplement lands in this book's file and reads back", async () => {
  const d = disk();
  const store = createSupplementStore(d.io);
  expect(await store.add(BOOK, ref())).toBe(true);
  expect(d.writes).toEqual([supplementsFile(BOOK)]);
  expect(await store.list(BOOK)).toEqual([ref()]);
  // One file per book: another book's list is untouched.
  expect(await store.list("bbbb2222")).toEqual([]);
});

test("the same hash again is not added, and nothing is rewritten", async () => {
  const d = disk();
  const store = createSupplementStore(d.io);
  await store.add(BOOK, ref());
  d.writes.length = 0;
  expect(await store.add(BOOK, ref({ title: "a later title" }))).toBe(false);
  expect(d.writes).toEqual([]);
  expect(await store.list(BOOK)).toEqual([ref()]);
});

test("two adds in flight at once both survive", async () => {
  const d = disk();
  const store = createSupplementStore(d.io);
  // Unserialized, these read the same empty list and the second write drops the
  // first one's entry — one chat turn ingesting two links is exactly this.
  await Promise.all([
    store.add(BOOK, ref({ hash: "one" })),
    store.add(BOOK, ref({ hash: "two" })),
  ]);
  expect((await store.list(BOOK)).map((s) => s.hash)).toEqual(["one", "two"]);
});

test("remove takes one out; a hash that is not there writes nothing", async () => {
  const d = disk();
  const store = createSupplementStore(d.io);
  await store.add(BOOK, ref({ hash: "one" }));
  await store.add(BOOK, ref({ hash: "two" }));
  await store.remove(BOOK, "one");
  expect((await store.list(BOOK)).map((s) => s.hash)).toEqual(["two"]);
  d.writes.length = 0;
  await store.remove(BOOK, "one");
  expect(d.writes).toEqual([]);
});

test("a file that is there and cannot be read raises rather than reading as empty", async () => {
  // An empty list would turn the next add into "this book has one supplement",
  // and the write would take the others off every device.
  const d = disk({}, { read: async () => ({ status: "corrupt", savedAs: null }) });
  const store = createSupplementStore(d.io);
  await expect(store.list(BOOK)).rejects.toThrow(/could not be read/);
  await expect(store.add(BOOK, ref())).rejects.toThrow(/could not be read/);
  expect(d.writes).toEqual([]);
});

test("a quarantined file starts the list again", async () => {
  const d = disk({}, { read: async () => ({ status: "corrupt", savedAs: "quarantine/x.json" }) });
  const store = createSupplementStore(d.io);
  expect(await store.list(BOOK)).toEqual([]);
  expect(await store.add(BOOK, ref())).toBe(true);
});

test("a write that fails does not block the next mutation", async () => {
  let fail = true;
  const d = disk(
    {},
    {
      write: async (file, contents) => {
        if (fail) throw new Error("disk full");
        d.files.set(file, contents);
      },
    },
  );
  const store = createSupplementStore(d.io);
  await expect(store.add(BOOK, ref({ hash: "one" }))).rejects.toThrow(/disk full/);
  fail = false;
  expect(await store.add(BOOK, ref({ hash: "two" }))).toBe(true);
  expect((await store.list(BOOK)).map((s) => s.hash)).toEqual(["two"]);
});
