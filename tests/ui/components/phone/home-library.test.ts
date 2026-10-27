// The phone home's Library covers (src/ui/components/phone/home-library.ts).

import { expect, test } from "bun:test";
import type { Topic } from "../../../../src/platform/app/topics";
import { continueLine, homeTopics, libraryTotalsLine } from "../../../../src/ui/components/phone/home-library";
import type { ContinueBook } from "../../../../src/ui/components/phone/shelf-list";

const topic = (id: string, createdAt: number, files = 1): Topic => ({
  id,
  name: id,
  createdAt,
  files: Array.from({ length: files }, (_, i) => ({ path: `${id}/${i}.epub`, name: `${i}.epub`, addedAt: 0, hash: `${id}-${i}` })),
});

const BOOK: ContinueBook = {
  topicId: "a",
  topicName: "a",
  bookId: "a-0",
  path: "a/0.epub",
  title: "0",
  file: { path: "a/0.epub", name: "0.epub", addedAt: 0, hash: "a-0" },
};

test("four covers: the book to continue first, then the newest topics", () => {
  const topics = [topic("a", 1), topic("b", 5), topic("c", 3), topic("d", 4), topic("e", 2)];
  expect(homeTopics(topics, BOOK).map((t) => t.id)).toEqual(["b", "d", "c"]);
  expect(homeTopics(topics, null).map((t) => t.id)).toEqual(["b", "d", "c", "e"]);
  expect(homeTopics([], null)).toEqual([]);
});

test("the continue line says how far in when that is known, and never 0%", () => {
  expect(continueLine(0.42)).toBe("Continue · 42%");
  expect(continueLine(0.001)).toBe("Continue · 1%");
  expect(continueLine(null)).toBe("Continue");
});

test("the All topics row counts topics and books, or says there are none", () => {
  expect(libraryTotalsLine([topic("a", 1, 2), topic("b", 2, 1)])).toBe("2 topics · 3 books");
  expect(libraryTotalsLine([])).toBe("No topics yet");
});
