// One run read from outside (src/reading/rehearsal/summary.ts): the row a list
// shows, and the word count of a transcript that is half Chinese. Run: bun test.

import { expect, test } from "bun:test";
import { countWords, runEntryOf, runSummary } from "../../../src/reading/rehearsal/summary";
import type {
  BuiltRun,
  RehearsalPage,
  RehearsalRunEntry,
} from "../../../src/reading/rehearsal/types";

// `kind` is the outline segment's id (src/reading/rehearsal/types.ts): one per
// position, which is what a pass over an outline produces.
function page(index: number, transcript: string, enteredAt = index * 1000): RehearsalPage {
  return {
    index,
    kind: `seg-${index}`,
    title: `Segment ${index}`,
    enteredAt,
    leftAt: enteredAt + 1000,
    transcript,
  };
}

// A run's log entry, counted the way the store counts it when it writes one.
function entry(pages: RehearsalPage[], over: Partial<BuiltRun> = {}): RehearsalRunEntry {
  return runEntryOf({
    id: "run-1",
    ordinal: 2,
    rehearsalId: "1754400000000",
    deckFile: null,
    startedAt: 0,
    endedAt: 600_000,
    pages,
    ...over,
  });
}

test("the summary counts the segments that were reached and the ones spoken to", () => {
  const s = runSummary(entry([page(0, "opening"), page(1, ""), page(2, "the argument")]));
  expect(s.ordinal).toBe(2);
  expect(s.startedAt).toBe(0);
  expect(s.segments).toBe(3);
  expect(s.segmentsSpoken).toBe(2);
  expect(s.wordsSpoken).toBe(3);
});

// The record is which segments, not how many: five passes over one segment are
// five runs naming that segment, and a pass that skipped the middle of the talk
// says which parts it skipped (docs/44).
test("the entry names the segments covered, and the ones spoken to", () => {
  const e = entry([page(0, "opening"), page(1, ""), page(2, "the argument")]);
  expect(e.segmentIds).toEqual(["seg-0", "seg-1", "seg-2"]);
  expect(e.spokenSegmentIds).toEqual(["seg-0", "seg-2"]);
});

// One segment given five times over is one segment covered, not five.
test("a segment gone back to is named once", () => {
  const e = entry([page(0, "again and again")]);
  expect(e.segmentIds).toEqual(["seg-0"]);
});

test("a segment of whitespace counts as silence", () => {
  expect(runSummary(entry([page(0, "   \n  ")])).segmentsSpoken).toBe(0);
});

test("the length is wall clock, rounded to whole minutes", () => {
  expect(runSummary(entry([], { startedAt: 0, endedAt: 12 * 60_000 })).minutes).toBe(12);
  expect(runSummary(entry([], { startedAt: 0, endedAt: 90_000 })).minutes).toBe(2);
});

// The app was closed mid-run: there is no end, but the pages say how far it got.
test("a run that was never ended is measured to the last thing that happened", () => {
  const pages = [page(0, "a", 0), { ...page(1, "b", 60_000), leftAt: null }];
  expect(runSummary(entry(pages, { endedAt: null })).minutes).toBe(1);
});

test("a run with nothing in it is zero minutes, not a negative number", () => {
  expect(runSummary(entry([], { startedAt: 5_000, endedAt: null })).minutes).toBe(0);
});

test("English is counted by whitespace", () => {
  expect(countWords("the argument does not follow")).toBe(5);
  expect(countWords("  spaced   out  ")).toBe(2);
  expect(countWords("")).toBe(0);
});

test("Chinese is counted one word per character, punctuation aside", () => {
  expect(countWords("这一章讲的是什么")).toBe(8);
  expect(countWords("你好，世界。")).toBe(4);
});

test("a mixed sentence counts each script its own way", () => {
  // Four characters, then two Latin words.
  expect(countWords("我们叫它 working memory")).toBe(6);
});

test("punctuation on its own is not a word", () => {
  expect(countWords("— ... !")).toBe(0);
});

// The transcripts moved into files of their own, so what a row shows was counted
// once, when the run was written — the entry a list is drawn from carries no
// pages at all.
test("a row is drawn from the counts in the entry, not from any pages", () => {
  const counted = entry([page(0, "两个字"), page(1, "two words here")]);
  expect(counted.pages).toBeUndefined();
  const s = runSummary(counted);
  expect(s.segments).toBe(2);
  expect(s.segmentsSpoken).toBe(2);
  expect(s.wordsSpoken).toBe(6);
  expect(s.minutes).toBe(10);
});

// An entry written before the split still carries its transcript and has no
// counts of its own. Counting off the pages there keeps its row right without
// rewriting the log to draw it.
test("an entry that still carries its pages is counted off them", () => {
  const s = runSummary({
    id: "run-1",
    ordinal: 1,
    rehearsalId: "1754400000000",
    deckFile: null,
    startedAt: 0,
    endedAt: 600_000,
    lastMomentAt: 0,
    segmentIds: [],
    spokenSegmentIds: [],
    wordsSpoken: 0,
    pages: [page(0, "opening"), page(1, ""), page(2, "the argument")],
  });
  expect(s.segments).toBe(3);
  expect(s.segmentsSpoken).toBe(2);
  expect(s.wordsSpoken).toBe(3);
  expect(s.minutes).toBe(10);
});

test("a whole run's words are the sum of its segments", () => {
  const s = runSummary(entry([page(0, "两个字"), page(1, "two words here")]));
  expect(s.wordsSpoken).toBe(6);
});
