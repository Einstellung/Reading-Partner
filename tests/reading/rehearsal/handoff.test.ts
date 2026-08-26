// A finished pass written out for the conversation
// (src/reading/rehearsal/handoff.ts): that it says which segments were given and
// which were not, that it names them the way the outline does, and that a pass
// with no words in it produces nothing at all.
// Run: bun test.

import { expect, test } from "bun:test";
import { passMessage } from "../../../src/reading/rehearsal/handoff";
import type { RehearsalPage, RehearsalRunEntry } from "../../../src/reading/rehearsal/types";
import { putSegment } from "../../../src/reading/talk/edit";
import { newTalkOutline, type TalkOutline } from "../../../src/reading/talk/types";

function outlineOf(...titles: string[]): TalkOutline {
  let outline = newTalkOutline({ id: "o1", topicId: "t1", name: "The eye", now: 1 });
  for (const [i, title] of titles.entries()) {
    outline = putSegment(outline, { body: title }, 1, () => `s${i + 1}`);
  }
  return outline;
}

function page(over: Partial<RehearsalPage> & { index: number; kind: string }): RehearsalPage {
  return {
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

// docs/44: a pass is the segments given this time, not "the nth time through".
// Going over one segment five times is five passes of one segment each, and the
// coach must not read that as a talk that lost the rest.
test("a partial pass says which segments it gave and that the rest were not", () => {
  const outline = outlineOf("Opening", "The cost", "The turn", "Closing");
  const text = passMessage({
    outline,
    entry: entry(),
    pages: [
      page({ index: 1, kind: "s2", transcript: "the retina throws most of it away" }),
      page({ index: 2, kind: "s3", transcript: "so the brain has to guess" }),
    ],
  });
  expect(text).toContain("pass 3");
  expect(text).toContain("I gave 2 of the 4 segment(s) in the talk: 2 and 3.");
  expect(text).toContain("nothing about them to hear");
  expect(text).toContain("Segment 2. The cost (id: s2)");
  expect(text).toContain("the retina throws most of it away");
  // The segments that were never up are not in the message at all.
  expect(text).not.toContain("Opening");
  expect(text).not.toContain("Closing");
});

test("a whole pass says so instead of listing every segment", () => {
  const outline = outlineOf("Opening", "The cost");
  const text = passMessage({
    outline,
    entry: entry(),
    pages: [
      page({ index: 0, kind: "s1", transcript: "here is what you think you see" }),
      page({ index: 1, kind: "s2", transcript: "and here is what arrives" }),
    ],
  });
  expect(text).toContain("I went through all 2 segment(s).");
  expect(text).not.toContain("nothing about them to hear");
});

// No STT key on the desktop and no dictation on the host both record a pass of
// segments and no words. There is nothing in that for a coach to hear, and a
// message saying so would only invite a reply about the silence.
test("a pass with no words in it hands nothing over", () => {
  const outline = outlineOf("Opening");
  expect(
    passMessage({ outline, entry: entry(), pages: [page({ index: 0, kind: "s1" })] }),
  ).toBe("");
  expect(passMessage({ outline, entry: entry(), pages: [] })).toBe("");
});

// A segment given in one pass and dropped from the talk before the next has no
// place in it any more; printing a number would give it somebody else's.
test("a segment no longer in the talk is named as such and still carries its words", () => {
  const outline = outlineOf("Opening");
  const text = passMessage({
    outline,
    entry: entry(),
    pages: [
      page({ index: 0, kind: "s1", transcript: "here is what you think you see" }),
      page({ index: 1, kind: "gone", title: "The cut segment", transcript: "and this bit" }),
    ],
  });
  expect(text).toContain("A segment that is no longer in the talk. The cut segment");
  expect(text).toContain("and this bit");
});

// A segment the reader went past without saying anything is not a failure, but
// the coach has to be able to tell it apart from one that was never up.
test("a segment that was up in silence is shown as said nothing", () => {
  const outline = outlineOf("Opening", "The cost");
  const text = passMessage({
    outline,
    entry: entry(),
    pages: [
      page({ index: 0, kind: "s1", transcript: "here is what you think you see" }),
      page({ index: 1, kind: "s2" }),
    ],
  });
  expect(text).toContain("(I said nothing on this one.)");
});
