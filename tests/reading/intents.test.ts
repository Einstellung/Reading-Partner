// The opening intents an empty conversation offers (src/reading/intents.ts).
// The table is data, so what is worth pinning is what the render layer and the
// turn assembly both depend on: the explain intent still sends the exact text
// the bubble used to send unprompted, the sets are distinct, and the book-level
// thread offers nothing at all. Run: bun test.

import { expect, test } from "bun:test";
import {
  EXPLAIN_KICKOFF,
  MARK_INTENTS,
  SPAN_INTENTS,
  asideIntents,
  bookTextNotice,
  openingIntents,
} from "../../src/reading/intents";

test("the first mark intent is the old unprompted kickoff, word for word", () => {
  expect(MARK_INTENTS[0].id).toBe("explain");
  expect(MARK_INTENTS[0].message).toBe(EXPLAIN_KICKOFF);
  expect(EXPLAIN_KICKOFF).toBe(
    "Please explain the passage I just marked, using the reading context above.",
  );
});

test("a mark offers four ways in", () => {
  expect(MARK_INTENTS).toHaveLength(4);
  expect(openingIntents(false)).toBe(MARK_INTENTS);
});

// docs/09, 2026-08-20: the reader types. The chips that were here spoke to
// someone deciding how to read the book themselves ("where should I start",
// "key ideas so far"), and the entry no longer assumes anyone is reading it. The
// one worth keeping said how to teach a chapter, and that is teaching discipline
// in the system prompt now (pinned in tests/context.test.ts).
test("the book-level thread opens with no chips at all", () => {
  expect(openingIntents(true)).toEqual([]);
});

// A side conversation opened on words picked out of a reply: there is no mark
// and no page, so a chip that opens on "the passage I just marked" would send
// the model looking for something the prompt does not carry.
test("a span pulled out of a reply is offered chips that claim no marked passage", () => {
  expect(asideIntents("chat")).toBe(SPAN_INTENTS);
  for (const intent of SPAN_INTENTS) {
    expect(intent.message.toLowerCase()).not.toContain("mark");
    expect(intent.message.toLowerCase()).not.toContain("passage");
  }
  expect(SPAN_INTENTS.some((i) => i.message === EXPLAIN_KICKOFF)).toBe(false);
});

// One drawn on the page while the lesson ran is a marked passage like any other.
test("a side conversation drawn on the page keeps the mark's chips", () => {
  expect(asideIntents("mark")).toBe(MARK_INTENTS);
});

test("every intent is a distinct id with a label and a message", () => {
  const all = [...MARK_INTENTS, ...SPAN_INTENTS];
  expect(new Set(all.map((i) => i.id)).size).toBe(all.length);
  for (const intent of all) {
    expect(intent.label.length).toBeGreaterThan(0);
    // Long enough to say something, short enough to be a chip in a 360px bubble.
    expect(intent.label.length).toBeLessThanOrEqual(26);
    expect(intent.message.length).toBeGreaterThan(intent.label.length);
    expect(intent.message.trim()).toBe(intent.message);
  }
});

// The extraction is what a book-level conversation waits on, and on a long book
// that is tens of seconds during which nothing it says can come out of the book.
// The reader gets a sentence instead of a guess.
test("a book still being extracted says so, in words", () => {
  const notice = bookTextNotice("extracting");
  expect(notice).toBe(
    "Still reading through this book — its pages can't be answered from just yet.",
  );
  // Not a technical state and not an error: nothing about extraction, text
  // layers, parsing or failure.
  for (const jargon of ["extract", "fulltext", "parse", "error", "failed", "null"]) {
    expect(notice!.toLowerCase()).not.toContain(jargon);
  }
});

test("a book with no text layer says that, rather than promising it shortly", () => {
  const notice = bookTextNotice("unreadable");
  expect(notice).toBe("This book's pages have no text layer, so they can't be read as text.");
  expect(notice).not.toContain("just yet");
});

// Four books in five have no usable chapter table (docs/09). Once the text is
// in, that is an ordinary book and not something to apologise for every time the
// entry is opened.
test("a book whose text is in says nothing", () => {
  expect(bookTextNotice("ok")).toBeNull();
});
