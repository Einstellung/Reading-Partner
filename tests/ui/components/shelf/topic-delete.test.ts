// A topic's delete confirmation (ui/components/shelf/topic-delete.ts): the list
// of files only in it, the box, and the action and receipt the box changes.

import { expect, test } from "bun:test";

import type { LibraryEntry } from "../../../../src/platform/app/library";
import type { FileRef, Topic } from "../../../../src/platform/app/topics";
import { fileTally, topicDeleteWords } from "../../../../src/ui/components/shelf/topic-delete";

const file = (name: string, hash?: string): FileRef => ({ path: `/${name}`, name, addedAt: 1, hash });
const topic = (id: string, files: FileRef[], createdAt = 1): Topic => ({ id, name: id, createdAt, files });

const P1 = file("Attention Is All You Need.pdf", "p1");
const P2 = file("Scaling Laws.pdf", "p2");
const E1 = file("Thinking Fast.epub", "e1");
const A1 = file("Why JITs are fast.html", "a1");
const ENTRIES = {
  e1: { format: "epub" },
  a1: { kind: "article" },
} as unknown as Record<string, LibraryEntry>;

test("the tally counts a PDF as a book", () => {
  expect(fileTally([P1, E1, A1], ENTRIES)).toBe("2 books and 1 article");
  expect(fileTally([A1], ENTRIES)).toBe("1 article");
});

test("several files only here: list, box, action and receipt", () => {
  const t = topic("JITs", [P1, E1, A1, P2]);
  const other = topic("Other", [P2]);
  const w = topicDeleteWords({ topic: t, topics: [t, other], only: [P1, E1, A1], entries: ENTRIES });
  expect(w.title).toBe("Delete “JITs”?");
  expect(w.rows.map((r) => [r.title, r.kind])).toEqual([
    ["Attention Is All You Need", "PDF"],
    ["Thinking Fast", "EPUB"],
    ["Why JITs are fast", "Article"],
  ]);
  expect(w.checkLabel).toBe("Also delete these 2 books and 1 article");
  expect(w.action(false)).toBe("Delete");
  expect(w.action(true)).toBe("Delete topic and all 3");
  expect(w.done(false)).toBe("Deleted “JITs”");
  expect(w.done(true)).toBe("Deleted “JITs”, 2 books and 1 article");
  expect(w.description).toContain("One book is also filed under another topic and stays there.");
});

test("one file only here names its kind", () => {
  const t = topic("T", [A1]);
  const w = topicDeleteWords({ topic: t, topics: [t], only: [A1], entries: ENTRIES });
  expect(w.checkLabel).toBe("Also delete this article");
  expect(w.action(true)).toBe("Delete topic and article");
  expect(w.done(true)).toBe("Deleted “T” and 1 article");
});

test("nothing only here: no box, and the shared files are said to stay", () => {
  const t = topic("T", [P1, P2, file("never-opened.pdf")]);
  const other = topic("O", [P1, P2]);
  const w = topicDeleteWords({ topic: t, topics: [t, other], only: [], entries: ENTRIES, savedArticles: 2 });
  expect(w.rows).toEqual([]);
  expect(w.checkLabel).toBeNull();
  expect(w.action(true)).toBe("Delete");
  expect(w.description).toBe(
    "The topic goes, on every device, with the retells, talks and rehearsals made in it. Articles saved here move to Brief. 2 books are also filed under other topics and stay there.",
  );
});
