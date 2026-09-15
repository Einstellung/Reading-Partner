import { expect, test } from "bun:test";
import {
  marksOfDocument,
  readingTheBook,
  threadHome,
  withMark,
} from "../../../src/reading/session/documents";

const IN_BOOK = { bookId: "book", docId: "book" };
const IN_SUPPLEMENT = { bookId: "book", docId: "supp" };

test("a session spent in the book cannot tell the two ids apart", () => {
  expect(readingTheBook(IN_BOOK)).toBe(true);
  expect(threadHome(null, IN_BOOK)).toBe("book");
  expect(threadHome({ isBook: true }, IN_BOOK)).toBe("book");
  expect(threadHome({}, IN_BOOK)).toBe("book");
});

test("the book's conversation stays the book's while a supplement is on screen", () => {
  expect(readingTheBook(IN_SUPPLEMENT)).toBe(false);
  expect(threadHome({ isBook: true }, IN_SUPPLEMENT)).toBe("book");
});

test("an aside is in the file its parent is in, which is the book's", () => {
  expect(threadHome({ aside: { parentThreadId: "t" } }, IN_SUPPLEMENT)).toBe("book");
});

test("a mark's conversation belongs to the document the mark is drawn on", () => {
  expect(threadHome({}, IN_SUPPLEMENT)).toBe("supp");
  expect(threadHome({ isBook: false }, IN_SUPPLEMENT)).toBe("supp");
});

test("nothing open is the document on screen", () => {
  expect(threadHome(null, IN_SUPPLEMENT)).toBe("supp");
  expect(threadHome(undefined, { bookId: null, docId: null })).toBe(null);
});

// A mark drawn on a reply is written to the file of the conversation it is on
// (docs/67): come back to the book and the marks on its lesson are there, even
// though a supplement was on screen when they were drawn.
test("marks whose conversation is in another file are not written to this one", () => {
  const marks = [{ id: "page-mark" }, { id: "on-the-lesson" }, { id: "on-this-document" }];
  const elsewhere = new Map([["on-the-lesson", "book"]]);
  expect(marksOfDocument(marks, elsewhere).map((m) => m.id)).toEqual([
    "page-mark",
    "on-this-document",
  ]);
  // Nothing is held back while the book itself is on screen.
  expect(marksOfDocument(marks, new Map()).map((m) => m.id)).toEqual([
    "page-mark",
    "on-the-lesson",
    "on-this-document",
  ]);
});

test("a mark going into another document's file is merged into what it has", () => {
  const existing = [{ id: "a", v: 1 }, { id: "b", v: 1 }];
  expect(withMark(existing, { id: "c", v: 1 }).map((m) => m.id)).toEqual(["a", "b", "c"]);
  // The same mark drawn on again replaces its copy rather than doubling it.
  expect(withMark(existing, { id: "b", v: 2 })).toEqual([
    { id: "a", v: 1 },
    { id: "b", v: 2 },
  ]);
});
