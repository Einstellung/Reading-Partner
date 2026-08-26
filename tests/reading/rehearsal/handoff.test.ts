// A finished pass written out for the conversation
// (src/reading/rehearsal/handoff.ts): that it hands over the words and the
// clock, that it says the reader may have given only part of the talk, that it
// does not carry the note, and that a pass with no words in it produces nothing
// at all.
// Run: bun test.

import { expect, test } from "bun:test";
import { passMessage } from "../../../src/reading/rehearsal/handoff";
import type { RehearsalPage, RehearsalRunEntry } from "../../../src/reading/rehearsal/types";

function page(over: Partial<RehearsalPage> = {}): RehearsalPage {
  return {
    index: 0,
    kind: "",
    title: "",
    enteredAt: 1_000,
    leftAt: 2_000,
    transcript: "",
    ...over,
  };
}

function entry(over: Partial<RehearsalRunEntry> = {}): RehearsalRunEntry {
  return {
    id: "run-1",
    ordinal: 3,
    rehearsalId: "r1",
    deckFile: null,
    startedAt: 0,
    endedAt: 120_000,
    lastMomentAt: 120_000,
    segmentIds: [],
    spokenSegmentIds: [],
    wordsSpoken: 12,
    ...over,
  };
}

test("the pass hands over which pass it is, how long, how many words, and the words", () => {
  const text = passMessage({
    entry: entry(),
    pages: [page({ transcript: "the retina throws most of it away" })],
  });
  expect(text).toContain("pass 3");
  expect(text).toContain("2 minute(s) and 12 words");
  expect(text).toContain("recogniser");
  expect(text).toContain("the retina throws most of it away");
});

// docs/44: a pass is what was given this time, not "the nth time through". Going
// over one part five times and skipping the rest is a reader working on that
// part, and the coach must not read it as a talk that lost the others.
test("the pass says the rest was left out on purpose", () => {
  const text = passMessage({ entry: entry(), pages: [page({ transcript: "so far so good" })] });
  expect(text).toContain("only part of it");
  expect(text).toContain("left out on purpose");
  expect(text).toContain("nothing about it to hear");
});

// Nothing on the note records where the reader was, and the message says so
// rather than leaving the coach to invent an order it was given in.
test("the pass says nothing recorded which block was up", () => {
  const text = passMessage({ entry: entry(), pages: [page({ transcript: "one two three" })] });
  expect(text).toContain("Nothing recorded which part of the note I was on");
});

// The note is already in the system prompt (coach.ts, formatTalkOutline). A copy
// in the message would be the whole talk twice in one request.
test("the pass does not carry the note", () => {
  const text = passMessage({
    entry: entry(),
    pages: [page({ transcript: "here is what you think you see" })],
  });
  expect(text).not.toContain("Segment");
  expect(text).not.toContain("id:");
});

// A pass recorded before the note surface has one stretch per segment. Its words
// are one transcript here, in the order they were spoken.
test("a pass recorded a segment at a time reads back as one transcript", () => {
  const text = passMessage({
    entry: entry(),
    pages: [
      page({ index: 0, kind: "s1", title: "Opening", transcript: "here is what you think you see" }),
      page({ index: 1, kind: "s2", title: "The cost", transcript: "and here is what arrives" }),
    ],
  });
  expect(text).toContain("here is what you think you see\nand here is what arrives");
});

// No STT key on the desktop and no dictation on the host both record a pass with
// no words in it. There is nothing in that for a coach to hear, and a message
// saying so would only invite a reply about the silence.
test("a pass with no words in it hands nothing over", () => {
  expect(passMessage({ entry: entry(), pages: [page()] })).toBe("");
  expect(passMessage({ entry: entry(), pages: [page({ transcript: "   \n " })] })).toBe("");
  expect(passMessage({ entry: entry(), pages: [] })).toBe("");
});
