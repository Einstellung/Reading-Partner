// The outline panel's logic (src/ui/components/rehearsal/outline-run.ts): the
// signal the Next button sends and where it goes. Plus the one claim the whole
// change rests on — that the button's event is the deck's page turn, so buildRun
// cuts the transcript the same way it always did (docs/44). Run: bun test.

import { expect, test } from "bun:test";
import {
  isSegmentChange,
  nextSegmentIndex,
  nextTitle,
  segmentEvent,
  segmentTitle,
  withSegmentEvent,
} from "../../../src/ui/components/rehearsal/outline-run";
import { buildRun } from "../../../src/reading/rehearsal/build";
import { runEntryOf } from "../../../src/reading/rehearsal/summary";
import type { RehearsalEvent } from "../../../src/reading/rehearsal/types";
import type { TalkSegment } from "../../../src/reading/talk/types";

function segment(over: Partial<TalkSegment> = {}): TalkSegment {
  return { id: "s1", body: "What the book is arguing", updatedAt: 0, ...over };
}

// --- the signal --------------------------------------------------------------

test("a segment going up is the same event a page turn was", () => {
  const e = segmentEvent(segment({ id: "abc", body: "## Opening" }), 3, 1_700);
  expect(e).toEqual({ kind: "slide", at: 1_700, index: 3, slideKind: "abc", title: "Opening" });
});

test("putting up the segment already on screen is not a change", () => {
  const events = withSegmentEvent([], segment({ id: "a" }), 0, 10);
  expect(isSegmentChange(events, 0)).toBe(false);
  expect(withSegmentEvent(events, segment({ id: "a" }), 0, 20)).toHaveLength(1);
});

test("going back to a segment is a change and is recorded again", () => {
  let events = withSegmentEvent([], segment({ id: "a" }), 0, 10);
  events = withSegmentEvent(events, segment({ id: "b" }), 1, 20);
  events = withSegmentEvent(events, segment({ id: "a" }), 0, 30);
  expect(events).toHaveLength(3);
  expect(isSegmentChange(events, 1)).toBe(true);
});

// Utterances between two segment events do not disturb the comparison: the
// panel appends them to the same list the segment events are in.
test("an utterance in between does not hide which segment is up", () => {
  const events: RehearsalEvent[] = [
    ...withSegmentEvent([], segment({ id: "a" }), 0, 10),
    { kind: "utterance", at: 12, endedAt: 14, text: "hello" },
  ];
  expect(isSegmentChange(events, 0)).toBe(false);
});

// --- where Next goes ---------------------------------------------------------

test("Next stops at the end rather than wrapping", () => {
  expect(nextSegmentIndex(0, 3)).toBe(1);
  expect(nextSegmentIndex(2, 3)).toBe(null);
  expect(nextSegmentIndex(0, 1)).toBe(null);
});

test("the next title is on screen while the current segment is being given", () => {
  const segments = [segment({ id: "a" }), segment({ id: "b", body: "## The turn" })];
  expect(nextTitle(segments, 0)).toBe("The turn");
  expect(nextTitle(segments, 1)).toBe(null);
});

// The name comes off the block itself (reading/talk/types.ts), so the list, the
// run's events and the pass handed to the coach all call a segment one thing.
test("a segment is named by the first line of its block", () => {
  expect(segmentTitle(segment({ body: "## The claim\n\nand the hook under it" }))).toBe(
    "The claim",
  );
});

// --- the whole path ----------------------------------------------------------

// What the change actually claims: the button's events go through buildRun
// untouched, an utterance lands on whichever segment was up when it started,
// and the run comes out saying which segments were covered.
test("a pass driven by the button records the segments it covered", () => {
  const segments = [
    segment({ id: "open", body: "Opening" }),
    segment({ id: "claim", body: "The claim" }),
    segment({ id: "close", body: "Closing" }),
  ];
  let events: RehearsalEvent[] = [];
  events = withSegmentEvent(events, segments[0], 0, 1_000);
  events = [...events, { kind: "utterance", at: 1_500, endedAt: 3_000, text: "Good evening." }];
  // Skipped straight to the last one, the way a reader picking out one part does.
  events = withSegmentEvent(events, segments[2], 2, 4_000);
  events = [...events, { kind: "utterance", at: 4_100, endedAt: 5_000, text: "So that is it." }];
  events = [...events, { kind: "end", at: 6_000 }];

  const entry = runEntryOf(
    buildRun({
      id: "run-1",
      ordinal: 1,
      rehearsalId: "r1",
      deckFile: null,
      startedAt: 1_000,
      events,
    }),
  );

  expect(entry.segmentIds).toEqual(["open", "close"]);
  expect(entry.spokenSegmentIds).toEqual(["open", "close"]);
  expect(entry.wordsSpoken).toBe(6);
});

// Going over one segment five times is a run naming that segment, which is what
// makes "practise this bit again" a shape the history can hold (docs/44).
test("one segment given twice over is one run naming one segment", () => {
  const only = segment({ id: "claim", body: "The claim" });
  let events: RehearsalEvent[] = withSegmentEvent([], only, 0, 1_000);
  events = [...events, { kind: "utterance", at: 1_200, endedAt: 2_000, text: "First go." }];
  // The reader stayed put and said it again; nothing to press, nothing recorded.
  events = withSegmentEvent(events, only, 0, 3_000);
  events = [...events, { kind: "utterance", at: 3_200, endedAt: 4_000, text: "Second go." }];
  events = [...events, { kind: "end", at: 5_000 }];

  const run = buildRun({
    id: "run-2",
    ordinal: 1,
    rehearsalId: "r1",
    deckFile: null,
    startedAt: 1_000,
    events,
  });
  expect(run.pages).toHaveLength(1);
  expect(run.pages[0].transcript).toBe("First go.\nSecond go.");
  expect(runEntryOf(run).segmentIds).toEqual(["claim"]);
});
