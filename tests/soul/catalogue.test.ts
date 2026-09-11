// What the soul can see of the palace (src/soul/catalogue.ts, docs/67). The
// walk is run against a literal store rather than a disk, the same way the
// sequence index is. Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import {
  LIST_CAP,
  buildCatalogueTools,
  forgetCatalogue,
  readCatalogue,
  shownRows,
  type CatalogueIo,
} from "../../src/soul";

interface FakeDisk {
  /** AppData-relative path to its text. A path with a slash is in a directory. */
  files: Record<string, string>;
  mtimes?: Record<string, number>;
}

interface Counted extends CatalogueIo {
  /** How many times the root was listed, and how many files were opened. */
  listings: number;
  reads: string[];
}

function io(disk: FakeDisk): Counted {
  const paths = (): string[] => Object.keys(disk.files);
  const fake: Counted = {
    listings: 0,
    reads: [],
    conversations: {
      listRoot: async () => {
        fake.listings += 1;
        return paths().filter((p) => !p.includes("/"));
      },
      readText: async (path) => {
        fake.reads.push(path);
        return disk.files[path] ?? null;
      },
      peekThreads: async () => [],
    },
    listDir: async (dir) => paths().filter((p) => p.startsWith(`${dir}/`)),
    mtime: async (path) => (path in disk.files ? (disk.mtimes?.[path] ?? 1) : null),
  };
  return fake;
}

const LIBRARY = JSON.stringify({
  books: {
    b1: { title: "Why We Remember", addedAt: 200 },
    b2: { title: "A History of Intelligence", addedAt: 100 },
  },
});

const TOPICS = JSON.stringify({
  topics: [
    { id: "t1", name: "robot learn", createdAt: 10, files: [{ hash: "b1" }] },
    { id: "t2", name: "brief", createdAt: 20, files: [] },
  ],
});

function store(over: Record<string, string> = {}): FakeDisk {
  return {
    files: {
      "library.json": LIBRARY,
      "topics.json": TOPICS,
      "threads-b1.json": "{}",
      "threads-b2.json": "{}",
      "annotations-b1.json": "[]",
      "threads-info-2026-07-21.json": "{}",
      "conversation-2026-09-10.json": "{}",
      "conversation-2026-09-11.json": "{}",
      "retell-7.json": JSON.stringify({ id: "7", name: "The talk I owe" }),
      "threads-retell-7.json": "{}",
      "outline-9.json": JSON.stringify({ id: "9", name: "Three constraints" }),
      "saved-articles.json": JSON.stringify([
        { id: "a1", title: "One paper", savedAt: 500 },
        { id: "a2", title: "Another paper", savedAt: 900 },
      ]),
      "statements.json": JSON.stringify({
        statements: [
          { id: "s1", text: "reads at night" },
          { id: "s2", text: "was wrong", supersededBy: "s1" },
        ],
      }),
      "observations/m-0000000000000001.md": "one",
      "observations/m-0000000000000002.md": "two",
      "observations/index.md": "the index, which is not an observation",
      // None of these is the soul's business: a derived cache, a raster, a
      // device ledger.
      "soul-sequence.json": "{}",
      "fulltext-0123456789abcdef0123456789abcdef.json": "{}",
      "sync-state.json": "{}",
      ...over,
    },
  };
}

function count(catalogue: { kinds: readonly { kind: string; count: number }[] }, kind: string) {
  return catalogue.kinds.find((k) => k.kind === kind)?.count;
}

beforeEach(() => {
  forgetCatalogue();
});

test("the shown kinds are the rows the table wrote a sentence for", async () => {
  const catalogue = await readCatalogue(io(store()));
  expect(catalogue.kinds.map((k) => k.kind)).toEqual(shownRows().map((r) => r.kind));
  for (const kind of catalogue.kinds) expect(kind.about).not.toBe("");
});

test("the walk counts every shown kind and leaves the rest of the store alone", async () => {
  const catalogue = await readCatalogue(io(store()));
  expect(count(catalogue, "library")).toBe(2);
  expect(count(catalogue, "topics")).toBe(2);
  expect(count(catalogue, "reading-thread")).toBe(2);
  expect(count(catalogue, "annotations")).toBe(1);
  expect(count(catalogue, "info-thread")).toBe(1);
  expect(count(catalogue, "conversation")).toBe(2);
  expect(count(catalogue, "retell")).toBe(1);
  expect(count(catalogue, "retell-thread")).toBe(1);
  expect(count(catalogue, "outline")).toBe(1);
  expect(count(catalogue, "saved-articles")).toBe(2);
  // The index beside the observations is a file of its own kind and is not one.
  expect(count(catalogue, "observation")).toBe(2);
  // The superseded statement is what a later one replaced, not what is held.
  expect(count(catalogue, "statements")).toBe(1);
  const shown = catalogue.kinds.map((k) => k.kind);
  for (const hidden of ["soul-sequence", "fulltext", "sync-state", "observation-index"]) {
    expect(shown).not.toContain(hidden);
  }
});

test("an item is named the way a person names it, and a book says its topic", async () => {
  const catalogue = await readCatalogue(io(store()));
  const one = (kind: string, id: string) =>
    catalogue.kinds.find((k) => k.kind === kind)!.entries.find((e) => e.id === id);
  expect(one("library", "b1")).toEqual({
    kind: "library",
    id: "b1",
    label: "Why We Remember",
    at: 200,
    under: "robot learn",
  });
  expect(one("library", "b2")?.under).toBeUndefined();
  expect(one("topics", "t1")?.label).toBe("robot learn");
  // A conversation over a book is named for the book, and one over a retelling
  // for the retelling: the id alone is a hash or a stamp.
  expect(one("reading-thread", "b1")?.label).toBe("Why We Remember");
  expect(one("annotations", "b1")?.label).toBe("Why We Remember");
  expect(one("retell", "7")?.label).toBe("The talk I owe");
  expect(one("retell-thread", "7")?.label).toBe("The talk I owe");
  expect(one("outline", "9")?.label).toBe("Three constraints");
  // A day-keyed file is named by its date, which is its id.
  expect(one("conversation", "2026-09-10")?.label).toBe("2026-09-10");
  expect(one("saved-articles", "a2")?.label).toBe("Another paper");
});

test("a book that is no longer on the shelf leaves its conversation unnamed", async () => {
  const catalogue = await readCatalogue(io(store({ "threads-gone.json": "{}" })));
  const entry = catalogue.kinds
    .find((k) => k.kind === "reading-thread")!
    .entries.find((e) => e.id === "gone");
  expect(entry?.label).toBe("");
});

test("entries come back newest first", async () => {
  const catalogue = await readCatalogue(io(store()));
  const ids = (kind: string) =>
    catalogue.kinds.find((k) => k.kind === kind)!.entries.map((e) => e.id);
  expect(ids("library")).toEqual(["b1", "b2"]);
  expect(ids("saved-articles")).toEqual(["a2", "a1"]);
  expect(ids("conversation")).toEqual(["2026-09-11", "2026-09-10"]);
  expect(ids("topics")).toEqual(["t2", "t1"]);
});

// --- the cache -------------------------------------------------------------

test("an unchanged store is walked once", async () => {
  const disk = store();
  const fake = io(disk);
  await readCatalogue(fake);
  const readsAfterFirst = fake.reads.length;
  expect(readsAfterFirst).toBeGreaterThan(0);
  await readCatalogue(fake);
  await readCatalogue(fake);
  expect(fake.reads.length).toBe(readsAfterFirst);
  // The staleness check itself lists the store every time; that is its price.
  expect(fake.listings).toBe(3);
});

test("a file that arrives is noticed", async () => {
  const disk = store();
  const fake = io(disk);
  expect(count(await readCatalogue(fake), "reading-thread")).toBe(2);
  disk.files["threads-b3.json"] = "{}";
  expect(count(await readCatalogue(fake), "reading-thread")).toBe(3);
});

test("a file that goes away is noticed", async () => {
  const disk = store();
  const fake = io(disk);
  expect(count(await readCatalogue(fake), "observation")).toBe(2);
  delete disk.files["observations/m-0000000000000002.md"];
  expect(count(await readCatalogue(fake), "observation")).toBe(1);
});

test("a label file rewritten under the same name is noticed", async () => {
  const disk = store();
  disk.mtimes = { "library.json": 1 };
  const fake = io(disk);
  expect(
    (await readCatalogue(fake)).kinds.find((k) => k.kind === "library")!.entries[0]!.label,
  ).toBe("Why We Remember");
  disk.files["library.json"] = JSON.stringify({ books: { b1: { title: "Renamed", addedAt: 200 } } });
  // The name set is unchanged, so only the stamp can tell.
  expect(
    (await readCatalogue(fake)).kinds.find((k) => k.kind === "library")!.entries[0]!.label,
  ).toBe("Why We Remember");
  disk.mtimes["library.json"] = 2;
  expect(
    (await readCatalogue(fake)).kinds.find((k) => k.kind === "library")!.entries[0]!.label,
  ).toBe("Renamed");
});

test("an empty store answers with the kinds and no entries", async () => {
  const catalogue = await readCatalogue(io({ files: {} }));
  expect(catalogue.kinds.length).toBe(shownRows().length);
  expect(catalogue.kinds.every((k) => k.count === 0)).toBe(true);
});

// --- the tools -------------------------------------------------------------

function tools(disk: FakeDisk) {
  const built = buildCatalogueTools(io(disk));
  return {
    palace: built.find((t) => t.name === "list_palace")!,
    kind: built.find((t) => t.name === "list_kind")!,
  };
}

async function text(tool: { execute(args: Record<string, unknown>): Promise<unknown> }, args = {}) {
  const out = await tool.execute(args);
  return typeof out === "string" ? out : (out as { text: string }).text;
}

test("list_palace is one line per kind, in table order", async () => {
  const out = await text(tools(store()).palace);
  const lines = out.split("\n").filter((l) => l.includes(" — "));
  expect(lines.length).toBe(shownRows().length);
  expect(lines[0]).toBe("library (2) — A book on the reader's shelf.");
  expect(out).toContain("observation (2) —");
  expect(out).not.toContain("fulltext");
});

test("list_kind prints the entries, a book with the topic it is listed under", async () => {
  const out = await text(tools(store()).kind, { kind: "library" });
  expect(out).toBe(
    "library (2), newest first:\n" +
      "b1  Why We Remember  [topic: robot learn]\n" +
      "b2  A History of Intelligence",
  );
});

test("a day-keyed kind prints the date once", async () => {
  const out = await text(tools(store()).kind, { kind: "conversation" });
  expect(out).toBe("conversation (2), newest first:\n2026-09-11\n2026-09-10");
});

test("a counted kind says how many and why there is nothing to list", async () => {
  const out = await text(tools(store()).kind, { kind: "statements" });
  expect(out).toStartWith("statements: 1.");
  expect(out).toContain("nothing to list");
});

test("a long kind is capped and says how many were left out", async () => {
  const many = Array.from({ length: LIST_CAP + 5 }, (_, i) => ({
    id: `a${i}`,
    title: `Paper ${i}`,
    savedAt: i,
  }));
  const out = await text(tools(store({ "saved-articles.json": JSON.stringify(many) })).kind, {
    kind: "saved-articles",
  });
  expect(out.split("\n").length).toBe(LIST_CAP + 2);
  expect(out).toEndWith("… and 5 more.");
});

test("a kind the soul may not see is refused by name", async () => {
  const out = await text(tools(store()).kind, { kind: "fulltext" });
  expect(out).toContain('no kind "fulltext"');
  expect(out).toContain("library");
});

test("an empty kind says so rather than printing an empty list", async () => {
  const out = await text(tools({ files: {} }).kind, { kind: "retell" });
  expect(out).toStartWith("No retell yet.");
});
