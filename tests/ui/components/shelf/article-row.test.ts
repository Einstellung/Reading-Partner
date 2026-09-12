// What an article says on the shelf, and which of a topic's files are rows
// rather than cover cards (src/ui/components/shelf/article-row.ts).
// Run: bun test.

import { expect, test } from "bun:test";
import {
  articleRowLine,
  formatArticleDate,
  splitMaterials,
} from "../../../../src/ui/components/shelf/article-row";
import type { LibraryEntry } from "../../../../src/platform/app/library";
import type { FileRef } from "../../../../src/platform/app/topics";

function article(over: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    hash: "a1",
    title: "A piece.epub",
    originalFilename: "A piece.epub",
    addedAt: 1,
    format: "epub",
    kind: "article",
    ...over,
  };
}

function file(over: Partial<FileRef> = {}): FileRef {
  return { path: "/topics/t/A piece.epub", name: "A piece.epub", addedAt: 1, ...over };
}

// --- the date ---------------------------------------------------------------

test("a date at the front of the value is cut verbatim, in any timezone", () => {
  expect(formatArticleDate("2026-09-12")).toBe("2026-09-12");
  // Late evening in New York: parsing this would move it to the 13th in UTC.
  expect(formatArticleDate("2026-09-12T23:30:00-05:00")).toBe("2026-09-12");
});

test("a date in another shape is parsed, and a non-date is shown as it came", () => {
  expect(formatArticleDate("Sep 12, 2026 00:00:00 UTC")).toBe("2026-09-12");
  expect(formatArticleDate("last Tuesday")).toBe("last Tuesday");
  expect(formatArticleDate(undefined)).toBe("");
  expect(formatArticleDate("   ")).toBe("");
});

// --- the line under the title ----------------------------------------------

test("the line is the host and the date", () => {
  expect(articleRowLine(article({ sourceUrl: "https://www.example.com/a/b?c=1", publishedAt: "2026-09-12" }))).toBe(
    "example.com · 2026-09-12",
  );
});

test("half a line is still a line, and none of it is empty", () => {
  expect(articleRowLine(article({ sourceUrl: "https://example.com/a" }))).toBe("example.com");
  expect(articleRowLine(article({ publishedAt: "2026-01-02" }))).toBe("2026-01-02");
  // A source that will not parse is dropped rather than shown broken.
  expect(articleRowLine(article({ sourceUrl: "not a url" }))).toBe("");
  expect(articleRowLine(article())).toBe("");
});

// --- the split --------------------------------------------------------------

test("articles become rows and keep the order they came in, after the books", () => {
  const b1 = file({ path: "/t/One.pdf", name: "One.pdf", hash: "b1" });
  const a1 = file({ path: "/t/First.epub", name: "First.epub", hash: "a1" });
  const b2 = file({ path: "/t/Two.pdf", name: "Two.pdf", hash: "b2" });
  const a2 = file({ path: "/t/Second.epub", name: "Second.epub", hash: "a2" });
  const entries: Record<string, LibraryEntry> = {
    b1: { hash: "b1", title: "One.pdf", originalFilename: "One.pdf", addedAt: 1 },
    b2: { hash: "b2", title: "Two.pdf", originalFilename: "Two.pdf", addedAt: 2 },
    a1: article({ hash: "a1", sourceUrl: "https://example.com/1", publishedAt: "2026-09-01" }),
    a2: article({ hash: "a2" }),
  };
  const split = splitMaterials([b1, a1, b2, a2], entries);
  expect(split.books.map((f) => f.path)).toEqual(["/t/One.pdf", "/t/Two.pdf"]);
  expect(split.articles.map((r) => r.file.path)).toEqual(["/t/First.epub", "/t/Second.epub"]);
  expect(split.articles[0].title).toBe("First");
  expect(split.articles[0].line).toBe("example.com · 2026-09-01");
  expect(split.articles[1].line).toBe("");
});

test("a file with no book id, or one the registry never saw, is a book", () => {
  const unopened = file({ path: "/t/Never.pdf", name: "Never.pdf" });
  const unknown = file({ path: "/t/Gone.pdf", name: "Gone.pdf", hash: "zz" });
  const split = splitMaterials([unopened, unknown], {});
  expect(split.books.map((f) => f.path)).toEqual(["/t/Never.pdf", "/t/Gone.pdf"]);
  expect(split.articles).toEqual([]);
});

// An entry written before articles existed has no `kind` at all; library.json is
// never migrated in place, so that is the normal case and not a missing field.
test("an entry with no kind is a book", () => {
  const f = file({ path: "/t/Old.pdf", name: "Old.pdf", hash: "old" });
  const split = splitMaterials([f], {
    old: { hash: "old", title: "Old.pdf", originalFilename: "Old.pdf", addedAt: 1 },
  });
  expect(split.books.length).toBe(1);
  expect(split.articles).toEqual([]);
});
