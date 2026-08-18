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
  openingIntents,
} from "../../src/reading/intents";

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
