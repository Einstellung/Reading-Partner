import { expect, test } from "bun:test";
import { readingTheBook, threadHome } from "../../../src/reading/session/documents";

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
