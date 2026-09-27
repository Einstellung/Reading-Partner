import { expect, test } from "bun:test";
import { outlineRows, ruleAt } from "../../../../../src/ui/components/reader/sidebar/outline-rows";

const BOOK = [
  { title: "One", level: 0, page: 1 },
  { title: "Two", level: 1, page: 9 },
];

const SUPPS = [
  { hash: "s1", title: "A page", sourceUrl: "https://www.example.com/x", addedAt: 1 },
  { hash: "s2", title: "Another", addedAt: 2 },
];

const source = (url: string | undefined) => (url ? new URL(url).hostname.replace(/^www\./, "") : "");

test("with no supplements the list is the book's outline and nothing else", () => {
  const rows = outlineRows({
    bookOutline: BOOK,
    bookTitle: "The Book",
    supplements: [],
    docId: "b",
    bookId: "b",
    displaySource: source,
  });
  expect(rows.map((r) => r.kind)).toEqual(["chapter", "chapter"]);
  expect(ruleAt(rows)).toBe(-1);
});

test("supplements come after the chapters, with their domain and the rule above them", () => {
  const rows = outlineRows({
    bookOutline: BOOK,
    bookTitle: "The Book",
    supplements: SUPPS,
    docId: "b",
    bookId: "b",
    displaySource: source,
  });
  expect(rows.map((r) => r.kind)).toEqual(["chapter", "chapter", "supplement", "supplement"]);
  expect(ruleAt(rows)).toBe(2);
  expect(rows[2]).toMatchObject({ title: "A page", source: "example.com", current: false });
  expect(rows[3]).toMatchObject({ title: "Another", source: "", current: false });
});

test("the row the reader is on is the lit one", () => {
  const rows = outlineRows({
    bookOutline: BOOK,
    bookTitle: "The Book",
    supplements: SUPPS,
    docId: "s2",
    bookId: "b",
    displaySource: source,
  });
  expect(rows.filter((r) => r.current)).toHaveLength(1);
  expect(rows.find((r) => r.current)).toMatchObject({ kind: "supplement", hash: "s2" });
  // The chapters are still the book's, and still drawn: they are the way back.
  expect(rows.filter((r) => r.kind === "chapter")).toHaveLength(2);
});

test("a book with no outline gets a row of its own to go back to, only when it needs one", () => {
  const withSupps = outlineRows({
    bookOutline: [],
    bookTitle: "Scanned",
    supplements: SUPPS,
    docId: "s1",
    bookId: "b",
    displaySource: source,
  });
  expect(withSupps.map((r) => r.kind)).toEqual(["book", "supplement", "supplement"]);
  expect(ruleAt(withSupps)).toBe(0);
  expect(withSupps[0]).toMatchObject({ title: "Scanned", current: false });

  const alone = outlineRows({
    bookOutline: [],
    bookTitle: "Scanned",
    supplements: [],
    docId: "b",
    bookId: "b",
    displaySource: source,
  });
  expect(alone).toEqual([]);
});
