// The opening intents an empty conversation offers (src/reading/intents.ts).
// The table is data, so what is worth pinning is what the render layer and the
// turn assembly both depend on: the explain intent still sends the exact text
// the bubble used to send unprompted, the two sets are distinct, and the
// book-level set never points at a passage that is not there. Run: bun test.

import { expect, test } from "bun:test";
import {
  BOOK_INTENTS,
  EXPLAIN_KICKOFF,
  MARK_INTENTS,
  bookTextNotice,
  chapterIntent,
  openingIntents,
} from "../../src/reading/intents";
import type { TableChapter } from "../../src/reading/chapters";

const CH3: TableChapter = {
  index: 4,
  number: 3,
  title: "Coding Attention Mechanisms",
  startPage: 64,
  endPage: 107,
};

test("the first mark intent is the old unprompted kickoff, word for word", () => {
  expect(MARK_INTENTS[0].id).toBe("explain");
  expect(MARK_INTENTS[0].message).toBe(EXPLAIN_KICKOFF);
  expect(EXPLAIN_KICKOFF).toBe(
    "Please explain the passage I just marked, using the reading context above.",
  );
});

test("a mark offers four ways in and the book-level thread its own", () => {
  expect(MARK_INTENTS).toHaveLength(4);
  expect(openingIntents(false)).toBe(MARK_INTENTS);
  expect(openingIntents(true)).toBe(BOOK_INTENTS);
  expect(BOOK_INTENTS.length).toBeGreaterThan(0);
});

// The book-level thread has no mark, so its prompt carries no marked passage
// (platform/app/context.ts drops every selection-derived part). An intent that
// says "this passage" would be asking about something the model cannot see.
test("no book-level intent points at a marked passage", () => {
  for (const intent of BOOK_INTENTS) {
    const message = intent.message.toLowerCase();
    expect(message).not.toContain("passage");
    expect(message).not.toContain("marked");
    expect(message).not.toContain("highlight");
  }
});

// docs/09: the chip carries the reader's own five requirements, and the label
// carries the chapter's title and page range, so a press is never a guess about
// which chapter was meant.
test("the chapter chip names the chapter and asks for it the way the reader did", () => {
  const chip = chapterIntent(CH3)!;
  expect(chip.focusChapter).toBe(3);
  expect(chip.label).toContain("ch.3");
  expect(chip.label).toContain("p.64-107");
  for (const part of ["p.64-107", "compressed", "stuck", "skip", "read myself"]) {
    expect(chip.message).toContain(part);
  }
});

// The focus is stored as the number the reader would say, so a chapter with no
// printed number cannot be parked on and is not offered.
test("a chapter with no printed number offers no chip", () => {
  expect(chapterIntent({ ...CH3, number: null })).toBeNull();
  expect(chapterIntent(null)).toBeNull();
  expect(openingIntents(true, { ...CH3, number: null })).toBe(BOOK_INTENTS);
});

test("the chapter chip leads the book-level set, and only there", () => {
  const withChapter = openingIntents(true, CH3);
  expect(withChapter[0].id).toBe("teach-chapter");
  expect(withChapter.length).toBe(BOOK_INTENTS.length + 1);
  // A marked passage's conversation is about the passage; the chapter chip has
  // no business in it.
  expect(openingIntents(false, CH3)).toBe(MARK_INTENTS);
});

test("every intent is a distinct id with a label and a message", () => {
  const all = [...MARK_INTENTS, ...BOOK_INTENTS];
  expect(new Set(all.map((i) => i.id)).size).toBe(all.length);
  for (const intent of all) {
    expect(intent.label.length).toBeGreaterThan(0);
    // Long enough to say something, short enough to be a chip in a 360px bubble.
    expect(intent.label.length).toBeLessThanOrEqual(26);
    expect(intent.message.length).toBeGreaterThan(intent.label.length);
    expect(intent.message.trim()).toBe(intent.message);
  }
});

// The chapter chip waits on the extraction, and on a long book that is tens of
// seconds during which the entry opens on two generic chips with no reason for
// the missing one. The reader gets a sentence instead of a guess.
test("a book still being extracted says so, in words", () => {
  const notice = bookTextNotice("extracting");
  expect(notice).toBe("Still reading through this book — its chapters will show up here shortly.");
  // Not a technical state and not an error: nothing about extraction, text
  // layers, parsing or failure.
  for (const jargon of ["extract", "fulltext", "parse", "error", "failed", "null"]) {
    expect(notice!.toLowerCase()).not.toContain(jargon);
  }
});

test("a book with no text layer says that, rather than promising chapters", () => {
  const notice = bookTextNotice("unreadable");
  expect(notice).toBe("This book's pages have no text layer, so they can't be read as text.");
  expect(notice).not.toContain("shortly");
});

// Four books in five have no usable chapter table (docs/09). Once the text is
// in, that is an ordinary book and not something to apologise for every time the
// entry is opened.
test("a book whose text is in says nothing", () => {
  expect(bookTextNotice("ok")).toBeNull();
});
