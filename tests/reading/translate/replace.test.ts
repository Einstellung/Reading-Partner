// The translation taking the original's place: the order the shelf, the topic,
// the marks and the delete happen in, and what the reader is told.
// Run: bash scripts/t.sh tests/reading/translate/replace.test.ts

import { expect, test } from "bun:test";
import type { ImportMeta, LibraryEntry } from "../../../src/platform/app/library";
import type { Thread } from "../../../src/platform/app/threads";
import { buildArticleEpub } from "../../../src/reading/epub/file/build-article";
import { parseEpub } from "../../../src/reading/epub/file/parse";
import {
  newEpubMark,
  quoteSelectorAt,
  rangeAtSpan,
} from "../../../src/reading/epub/annotation";
import { rangeToCfi } from "../../../src/reading/epub/file/cfi";
import type { MarkRecord } from "../../../src/reading/translate/carry-marks";
import {
  documentPathOf,
  orphanedThreadIds,
  replaceWithTranslation,
  summaryLine,
  translatedFileName,
  translatedTitle,
  type ReplaceDeps,
} from "../../../src/reading/translate/replace";
import { translateArticleEpub } from "../../../src/reading/translate/translate-article";
import type { TranslateBatchFn } from "../../../src/reading/translate/prompt";

const INPUT = {
  title: "How a web page becomes a book",
  byline: "A Writer",
  sourceUrl: "https://example.com/posts/one",
  publishedAt: "2026-09-01",
  html: `<p>A zip file with a spine is a book once something can read it.</p>
    <h2 id="s">The first section</h2>
    <p>The pagination is measured against the tree, never against the source.</p>`,
  images: [],
};

const ORIGINAL: LibraryEntry = {
  hash: "old-book-id",
  title: "how-a-web-page-becomes-a-book.epub",
  originalFilename: "how-a-web-page-becomes-a-book.epub",
  addedAt: 1,
  format: "epub",
  kind: "article",
  sourceUrl: INPUT.sourceUrl,
  byline: INPUT.byline,
  publishedAt: INPUT.publishedAt,
};

const translator: TranslateBatchFn = async (request) => ({
  blocks: request.blocks.map((b) => ({ id: b.id, text: `[zh]${b.text}` })),
});

function markOver(bytes: Uint8Array, phrase: string): MarkRecord {
  const spine = parseEpub(bytes).docs[0];
  const start = spine.text.text.indexOf(phrase);
  expect(start).toBeGreaterThanOrEqual(0);
  const span = { start, end: start + phrase.length };
  const range = rangeAtSpan(spine.doc, spine.text, span);
  const cfi = rangeToCfi(range as Range, spine.index, spine.idref);
  return newEpubMark({
    id: "m1",
    stroke: "highlight",
    color: "#ffd400",
    cfi: cfi as string,
    spineIndex: spine.index,
    span,
    pageIndex: 2,
    pageLabel: "3",
    quote: quoteSelectorAt(spine.text.text, span),
    authorName: "A Reader",
    now: "2026-09-13T00:00:00Z",
  });
}

function thread(id: string, annotationId: string, over: Partial<Thread> = {}): Thread {
  return {
    id,
    annotationId,
    ...(annotationId === "" ? { book: true } : {}),
    path: "old-book-id",
    createdAt: 10,
    messages: [{ role: "user", text: `about ${id}`, ts: 11 }],
    ...over,
  };
}

interface Recorded {
  deps: ReplaceDeps;
  order: string[];
  imported: { path: string; meta: ImportMeta } | null;
  attached: { topicId: string; path: string; hash: string } | null;
  supplement: { bookId: string; oldHash: string; ref: { hash: string; title: string; sourceUrl?: string } } | null;
  saved: Map<string, MarkRecord[]>;
  threads: Map<string, Thread[]>;
  deleted: string[];
  successors: Array<{ hash: string; path: string }>;
}

async function recorder(marks: MarkRecord[] = [], threads: Thread[] = []): Promise<Recorded> {
  const original = await buildArticleEpub(INPUT);
  const rec: Recorded = {
    order: [],
    imported: null,
    attached: null,
    supplement: null,
    saved: new Map(),
    threads: new Map([["old-book-id", threads]]),
    deleted: [],
    successors: [],
    deps: {} as ReplaceDeps,
  };
  rec.deps = {
    readBook: async () => original,
    translate: async (bytes, onProgress) => {
      rec.order.push("translate");
      return await translateArticleEpub(bytes, {
        translateGlossary: async () => [],
        translateBatch: translator,
        onProgress,
        limiter: { rampMs: 0 },
        timers: { now: () => 0, sleep: async () => {} },
      });
    },
    hash: async () => "new-book-id",
    importBook: async (_bytes, path, meta) => {
      rec.order.push("import");
      rec.imported = { path, meta };
      return { ...ORIGINAL, hash: "new-book-id", title: path, originalFilename: path };
    },
    attach: async (topicId, path, hash) => {
      rec.order.push("attach");
      rec.attached = { topicId, path, hash };
    },
    replaceSupplement: async (bookId, oldHash, ref) => {
      rec.order.push("supplement");
      rec.supplement = { bookId, oldHash, ref };
    },
    loadMarks: async () => marks,
    saveMarks: async (bookId, saved) => {
      rec.order.push("save-marks");
      rec.saved.set(bookId, saved);
    },
    loadThreads: async (bookId) => rec.threads.get(bookId) ?? [],
    adoptThreads: async (bookId, moved) => {
      rec.order.push("adopt-threads");
      rec.threads.set(bookId, [...moved]);
    },
    targetOf: (bytes) => {
      const doc = parseEpub(bytes).docs[0];
      return { doc: doc.doc, text: doc.text, spineIndex: doc.index, idref: doc.idref };
    },
    retireOriginal: async (bookId, successor) => {
      rec.successors.push(successor);
      rec.order.push("delete");
      rec.deleted.push(bookId);
      // What reading/delete does to a book's own files, by the id it was given.
      rec.threads.delete(bookId);
    },
  };
  return rec;
}

test("the new document is filed and the marks are moved before the old one goes", async () => {
  const rec = await recorder([markOver(await buildArticleEpub(INPUT), "measured against the tree")]);
  const progress: number[] = [];
  const result = await replaceWithTranslation(ORIGINAL, { kind: "topic", topicId: "t1" }, rec.deps, (done) =>
    progress.push(done),
  );

  expect(rec.order).toEqual(["translate", "import", "attach", "save-marks", "delete"]);
  expect(result.threads).toBe(0);
  expect(result.blocks).toBeGreaterThan(0);
  expect(result.moved).toBe(1);
  expect(result.unmatched).toBe(0);
  expect(progress[progress.length - 1]).toBe(result.blocks);
  // The marks are written under the new book, never back onto the old one.
  expect([...rec.saved.keys()]).toEqual(["new-book-id"]);
});

test("the translation carries the original's source fields and says what it came from", async () => {
  const rec = await recorder();
  await replaceWithTranslation(ORIGINAL, { kind: "topic", topicId: "t1" }, rec.deps);
  expect(rec.imported?.meta).toEqual({
    kind: "article",
    sourceUrl: INPUT.sourceUrl,
    byline: INPUT.byline,
    publishedAt: INPUT.publishedAt,
    translatedFrom: "old-book-id",
  });
  expect(rec.imported?.path).toBe(
    documentPathOf("new-book-id", "how-a-web-page-becomes-a-book-zh.epub"),
  );
  expect(rec.attached).toEqual({
    topicId: "t1",
    path: rec.imported?.path as string,
    hash: "new-book-id",
  });
});

test("a mark whose words are gone is counted, not guessed at", async () => {
  const stray: MarkRecord = {
    id: "m2",
    quote: { type: "TextQuoteSelector", exact: "a sentence that was never in this article" },
    sortIndex: "",
  };
  const rec = await recorder([stray]);
  const result = await replaceWithTranslation(ORIGINAL, { kind: "topic", topicId: null }, rec.deps);
  expect(result.moved).toBe(0);
  expect(result.unmatched).toBe(1);
  // Nothing was written, and with no topic named nothing was filed either.
  expect(rec.saved.size).toBe(0);
  expect(rec.attached).toBeNull();
});

test("a failed translation leaves the shelf alone", async () => {
  const rec = await recorder();
  rec.deps.translate = async () => {
    throw new Error("the glossary could not be settled");
  };
  await expect(replaceWithTranslation(ORIGINAL, { kind: "topic", topicId: "t1" }, rec.deps)).rejects.toThrow("glossary");
  expect(rec.order).toEqual([]);
});

test("the closing line counts blocks and marks", () => {
  const base = {
    entry: ORIGINAL,
    path: "p",
    blocks: 30,
    moved: 4,
    unmatched: 1,
    threads: 0,
    orphanedThreads: 0,
  };
  expect(summaryLine("A paper", base)).toBe(
    'Translated "A paper": 30 blocks, 4 marks moved, 1 could not be moved.',
  );
  expect(summaryLine("A paper", { ...base, moved: 1, unmatched: 0 })).toBe(
    'Translated "A paper": 30 blocks, 1 mark moved.',
  );
  expect(summaryLine("A paper", { ...base, moved: 0, unmatched: 0 })).toBe(
    'Translated "A paper": 30 blocks, no marks to move.',
  );
});

test("the translation is not called the same thing as the original", () => {
  expect(translatedFileName("a-paper.epub")).toBe("a-paper-zh.epub");
  expect(translatedFileName("a.paper.html")).toBe("a.paper-zh.epub");
  expect(translatedFileName("noextension")).toBe("noextension-zh.epub");
});

// --- the conversations -------------------------------------------------------

test("the conversations move to the translation, ids and messages unchanged", async () => {
  const mark = markOver(await buildArticleEpub(INPUT), "measured against the tree");
  const lesson = thread("t-book", "");
  const onMark = thread("t-mark", String(mark.id));
  const rec = await recorder([mark], [lesson, onMark]);

  const result = await replaceWithTranslation(ORIGINAL, { kind: "topic", topicId: "t1" }, rec.deps);

  // Moved after the marks and before the original goes.
  expect(rec.order).toEqual([
    "translate",
    "import",
    "attach",
    "save-marks",
    "adopt-threads",
    "delete",
  ]);
  expect(result.threads).toBe(2);
  expect(result.orphanedThreads).toBe(0);

  const carried = rec.threads.get("new-book-id") as Thread[];
  expect(carried.map((t) => t.id)).toEqual(["t-book", "t-mark"]);
  expect(carried.map((t) => t.annotationId)).toEqual(["", String(mark.id)]);
  expect(carried[0].messages).toEqual(lesson.messages);
  // The mark the thread is anchored on kept its id through the carry, which is
  // the only thing that makes the anchor still mean something.
  const savedMarks = rec.saved.get("new-book-id") as MarkRecord[];
  expect(savedMarks.map((m) => m.id)).toEqual([String(mark.id)]);

  // And the delete, which works by the old id, took nothing with it.
  expect(rec.deleted).toEqual(["old-book-id"]);
  // Retired in favour of the translation, under the path the topic lists it by.
  expect(rec.successors).toEqual([{ hash: "new-book-id", path: result.path }]);
  expect(rec.threads.get("old-book-id")).toBeUndefined();
});

test("a thread whose mark did not come across is kept and counted", async () => {
  const stray: MarkRecord = {
    id: "m-gone",
    quote: { type: "TextQuoteSelector", exact: "a sentence that was never in this article" },
    sortIndex: "",
  };
  const rec = await recorder([stray], [thread("t-book", ""), thread("t-orphan", "m-gone")]);
  const result = await replaceWithTranslation(ORIGINAL, { kind: "topic", topicId: "t1" }, rec.deps);

  expect(result.unmatched).toBe(1);
  expect(result.threads).toBe(2);
  expect(result.orphanedThreads).toBe(1);
  const carried = rec.threads.get("new-book-id") as Thread[];
  expect(carried.map((t) => t.id)).toEqual(["t-book", "t-orphan"]);
});

test("an orphaned thread is one anchored on a mark that is not in the new document", () => {
  const threads = [thread("t-book", ""), thread("t-a", "m1"), thread("t-b", "m2")];
  expect(orphanedThreadIds(threads, new Set(["m1"]))).toEqual(["t-b"]);
  expect(orphanedThreadIds(threads, new Set(["m1", "m2"]))).toEqual([]);
  expect(orphanedThreadIds([], new Set())).toEqual([]);
});

// A supplement's translation is filed where the supplement was: under the book,
// not in a topic (docs/67 「辅助资料」). One row before and after, and the row is
// under the new document's id.
test("a supplement is replaced in the book's list, not in a topic", async () => {
  const rec = await recorder();
  const result = await replaceWithTranslation(
    ORIGINAL,
    { kind: "book", bookId: "the-book" },
    rec.deps,
  );

  expect(rec.order).toEqual(["translate", "import", "supplement", "delete"]);
  expect(rec.attached).toBeNull();
  expect(rec.supplement).toEqual({
    bookId: "the-book",
    oldHash: "old-book-id",
    ref: {
      hash: "new-book-id",
      title: translatedTitle(ORIGINAL.originalFilename),
      sourceUrl: INPUT.sourceUrl,
    },
  });
  // The title is what a [Title p.N] citation says, so it is the file name
  // without its extension — the same shape the ingest gives a row.
  expect(translatedTitle(ORIGINAL.originalFilename)).toBe("how-a-web-page-becomes-a-book-zh");
  expect(result.entry.hash).toBe("new-book-id");
  expect(rec.deleted).toEqual(["old-book-id"]);
});
