// One document taking another's place (src/reading/replace/replace.ts): the
// order the shelf, the marks, the position, the conversations and the retirement
// happen in, whoever made the new file. The translation's own step in front is
// tests/reading/translate/replace.test.ts.
// Run: bash scripts/t.sh tests/reading/replace/replace.test.ts

import { expect, test } from "bun:test";
import type { LibraryEntry } from "../../../src/platform/app/library";
import type { ViewState } from "../../../src/platform/app/reader-contract";
import type { Thread } from "../../../src/platform/app/threads";
import type { MarkRecord } from "../../../src/reading/replace/carry-marks";
import {
  marksClause,
  mergedMarks,
  replaceDocument,
  type ReplaceDeps,
  type SuccessorFile,
} from "../../../src/reading/replace/replace";

const OLD: LibraryEntry = {
  hash: "v1",
  title: "booklet.epub",
  originalFilename: "booklet.epub",
  addedAt: 1,
  format: "epub",
};

const NEXT: SuccessorFile = {
  bytes: new Uint8Array([2]),
  fileName: "booklet.epub",
  meta: {},
  title: "booklet",
};

const POSITION: ViewState = { pageIndex: 7, scale: 1, scrollMode: 0, cfi: "epubcfi(/6/4!/4/2/1:0)" };

function recorder(
  opts: {
    marks?: Record<string, MarkRecord[]>;
    positions?: Record<string, ViewState>;
    threads?: Thread[];
    carry?: (marks: MarkRecord[]) => { moved: MarkRecord[]; unmatched: MarkRecord[] };
  } = {},
) {
  const order: string[] = [];
  const marks = new Map(Object.entries(opts.marks ?? {}));
  const positions = new Map(Object.entries(opts.positions ?? {}));
  const threads = new Map<string, Thread[]>([["v1", opts.threads ?? []]]);
  const deps: ReplaceDeps = {
    hash: async () => "v2",
    importBook: async (_bytes, path) => {
      order.push("import");
      return { ...OLD, hash: "v2", title: path, originalFilename: path };
    },
    attach: async () => {
      order.push("attach");
    },
    replaceSupplement: async () => {
      order.push("supplement");
    },
    loadMarks: async (bookId) => marks.get(bookId) ?? [],
    saveMarks: async (bookId, saved) => {
      order.push("save-marks");
      marks.set(bookId, saved);
    },
    carryMarks: async (toCarry) =>
      opts.carry?.(toCarry) ?? { moved: toCarry.map((m) => ({ ...m, carried: true })), unmatched: [] },
    getViewState: async (bookId) => positions.get(bookId) ?? null,
    saveViewState: async (bookId, state) => {
      order.push("save-position");
      positions.set(bookId, state);
    },
    carryPosition: async (state) => ({ ...state, cfi: "epubcfi(/6/6!/4/8/1:3)" }),
    loadThreads: async (bookId) => threads.get(bookId) ?? [],
    adoptThreads: async (bookId, moved) => {
      order.push("adopt-threads");
      threads.set(bookId, [...moved]);
    },
    retireOriginal: async (bookId) => {
      order.push("retire");
      threads.delete(bookId);
    },
  };
  return { deps, order, marks, positions, threads };
}

const thread = (id: string, annotationId: string): Thread => ({
  id,
  annotationId,
  path: "v1",
  createdAt: 1,
  messages: [],
});

test("the new version is filed, the work moves onto it, and only then does the old one go", async () => {
  const rec = recorder({
    marks: { v1: [{ id: "m1" }, { id: "m2" }] },
    positions: { v1: POSITION },
    threads: [thread("t1", "m1")],
  });
  const result = await replaceDocument(OLD, { kind: "topic", topicId: "t" }, new Uint8Array([1]), NEXT, rec.deps);

  expect(rec.order).toEqual(["import", "attach", "save-marks", "save-position", "adopt-threads", "retire"]);
  expect(result).toMatchObject({
    path: "library/v2/booklet.epub",
    moved: 2,
    unmatched: 0,
    threads: 1,
    orphanedThreads: 0,
  });
  expect(rec.marks.get("v2")?.map((m) => m.carried)).toEqual([true, true]);
  // The position is the carried one: page number kept, CFI rewritten.
  expect(rec.positions.get("v2")).toEqual({ ...POSITION, cfi: "epubcfi(/6/6!/4/8/1:3)" });
  expect(rec.threads.get("v2")?.map((t) => t.id)).toEqual(["t1"]);
});

test("a new version that was on the shelf already keeps its own marks beside the carried ones", async () => {
  const rec = recorder({
    marks: { v1: [{ id: "m1" }, { id: "m2" }], v2: [{ id: "m2", own: true }, { id: "m9" }] },
  });
  await replaceDocument(OLD, { kind: "topic", topicId: "t" }, new Uint8Array([1]), NEXT, rec.deps);
  expect(rec.marks.get("v2")?.map((m) => m.id)).toEqual(["m2", "m9", "m1"]);
  expect(rec.marks.get("v2")?.[0].own).toBe(true);
});

test("with nothing to move, nothing but the import and the retirement happens", async () => {
  const rec = recorder();
  const result = await replaceDocument(OLD, { kind: "topic", topicId: null }, new Uint8Array([1]), NEXT, rec.deps);
  expect(rec.order).toEqual(["import", "retire"]);
  expect(result.moved).toBe(0);
});

test("marks that do not come across are counted, and the threads on them too", async () => {
  const rec = recorder({
    marks: { v1: [{ id: "m1" }, { id: "m2" }] },
    threads: [thread("t2", "m2")],
    carry: (marks) => ({ moved: [marks[0]], unmatched: [marks[1]] }),
  });
  const result = await replaceDocument(OLD, { kind: "book", bookId: "b" }, new Uint8Array([1]), NEXT, rec.deps);
  expect(rec.order).toEqual(["import", "supplement", "save-marks", "adopt-threads", "retire"]);
  expect(result).toMatchObject({ moved: 1, unmatched: 1, orphanedThreads: 1 });
});

test("a file that is the original is not filed anywhere and retires nothing", async () => {
  const rec = recorder();
  rec.deps.importBook = async () => {
    rec.order.push("import");
    return OLD;
  };
  await expect(
    replaceDocument(OLD, { kind: "topic", topicId: "t" }, new Uint8Array([1]), NEXT, rec.deps),
  ).rejects.toThrow("same as the one it replaces");
  expect(rec.order).toEqual(["import"]);
});

test("the marks half sentence", () => {
  expect(marksClause({ moved: 0, unmatched: 0 })).toBe("no marks to move");
  expect(marksClause({ moved: 1, unmatched: 0 })).toBe("1 mark moved");
  expect(marksClause({ moved: 3, unmatched: 2 })).toBe("3 marks moved, 2 could not be moved");
  expect(mergedMarks([], [{ id: 1 }]).map((m) => m.id)).toEqual([1]);
});
