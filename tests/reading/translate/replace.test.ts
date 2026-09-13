// The translation taking the original's place: the order the shelf, the topic,
// the marks and the delete happen in, and what the reader is told.
// Run: bash scripts/t.sh tests/reading/translate/replace.test.ts

import { expect, test } from "bun:test";
import type { ImportMeta, LibraryEntry } from "../../../src/platform/app/library";
import { buildArticleEpub } from "../../../src/reading/epub/build-article";
import { parseEpub } from "../../../src/reading/epub/parse";
import {
  newEpubMark,
  quoteSelectorAt,
  rangeAtSpan,
} from "../../../src/reading/epub/annotation";
import { rangeToCfi } from "../../../src/reading/epub/cfi";
import type { MarkRecord } from "../../../src/reading/translate/carry-marks";
import {
  documentPathOf,
  replaceWithTranslation,
  summaryLine,
  translatedFileName,
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

interface Recorded {
  deps: ReplaceDeps;
  order: string[];
  imported: { path: string; meta: ImportMeta } | null;
  attached: { topicId: string; path: string; hash: string } | null;
  saved: Map<string, MarkRecord[]>;
}

async function recorder(marks: MarkRecord[] = []): Promise<Recorded> {
  const original = await buildArticleEpub(INPUT);
  const rec: Recorded = {
    order: [],
    imported: null,
    attached: null,
    saved: new Map(),
    deps: {} as ReplaceDeps,
  };
  rec.deps = {
    readBook: async () => original,
    translate: async (bytes, onProgress) => {
      rec.order.push("translate");
      return await translateArticleEpub(bytes, {
        buildGlossary: async () => [],
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
    loadMarks: async () => marks,
    saveMarks: async (bookId, saved) => {
      rec.order.push("save-marks");
      rec.saved.set(bookId, saved);
    },
    targetOf: (bytes) => {
      const doc = parseEpub(bytes).docs[0];
      return { doc: doc.doc, text: doc.text, spineIndex: doc.index, idref: doc.idref };
    },
    deleteBook: async () => {
      rec.order.push("delete");
    },
  };
  return rec;
}

test("the new document is filed and the marks are moved before the old one goes", async () => {
  const rec = await recorder([markOver(await buildArticleEpub(INPUT), "measured against the tree")]);
  const progress: number[] = [];
  const result = await replaceWithTranslation(ORIGINAL, "t1", rec.deps, (done) =>
    progress.push(done),
  );

  expect(rec.order).toEqual(["translate", "import", "attach", "save-marks", "delete"]);
  expect(result.blocks).toBeGreaterThan(0);
  expect(result.moved).toBe(1);
  expect(result.unmatched).toBe(0);
  expect(progress[progress.length - 1]).toBe(result.blocks);
  // The marks are written under the new book, never back onto the old one.
  expect([...rec.saved.keys()]).toEqual(["new-book-id"]);
});

test("the translation carries the original's source fields and says what it came from", async () => {
  const rec = await recorder();
  await replaceWithTranslation(ORIGINAL, "t1", rec.deps);
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
  const result = await replaceWithTranslation(ORIGINAL, null, rec.deps);
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
  await expect(replaceWithTranslation(ORIGINAL, "t1", rec.deps)).rejects.toThrow("glossary");
  expect(rec.order).toEqual([]);
});

test("the closing line counts blocks and marks", () => {
  const base = { entry: ORIGINAL, path: "p", blocks: 30, moved: 4, unmatched: 1 };
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
