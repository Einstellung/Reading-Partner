// One run read from outside (src/reading/runthrough/summary.ts): the row a list
// shows, and the word count of a transcript that is half Chinese. Run: bun test.

import { expect, test } from "bun:test";
import { countWords, runSummary } from "../../../src/reading/runthrough/summary";
import type { RunthroughPage, RunthroughRun } from "../../../src/reading/runthrough/types";

function page(index: number, transcript: string, enteredAt = index * 1000): RunthroughPage {
  return {
    index,
    kind: "content",
    title: `Page ${index}`,
    enteredAt,
    leftAt: enteredAt + 1000,
    transcript,
  };
}

function run(pages: RunthroughPage[], over: Partial<RunthroughRun> = {}): RunthroughRun {
  return {
    id: "run-1",
    ordinal: 2,
    talkId: "talk-1",
    deckFile: null,
    startedAt: 0,
    endedAt: 600_000,
    pages,
    ...over,
  };
}

test("the summary counts the pages that were reached and the ones spoken to", () => {
  const s = runSummary(run([page(0, "opening"), page(1, ""), page(2, "the argument")]));
  expect(s.ordinal).toBe(2);
  expect(s.startedAt).toBe(0);
  expect(s.pagesTotal).toBe(3);
  expect(s.pagesSpoken).toBe(2);
  expect(s.wordsSpoken).toBe(3);
});

test("a page of whitespace counts as silence", () => {
  expect(runSummary(run([page(0, "   \n  ")])).pagesSpoken).toBe(0);
});

test("the length is wall clock, rounded to whole minutes", () => {
  expect(runSummary(run([], { startedAt: 0, endedAt: 12 * 60_000 })).minutes).toBe(12);
  expect(runSummary(run([], { startedAt: 0, endedAt: 90_000 })).minutes).toBe(2);
});

// The app was closed mid-run: there is no end, but the pages say how far it got.
test("a run that was never ended is measured to the last thing that happened", () => {
  const pages = [page(0, "a", 0), { ...page(1, "b", 60_000), leftAt: null }];
  expect(runSummary(run(pages, { endedAt: null })).minutes).toBe(1);
});

test("a run with nothing in it is zero minutes, not a negative number", () => {
  expect(runSummary(run([], { startedAt: 5_000, endedAt: null })).minutes).toBe(0);
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

test("a whole run's words are the sum of its pages", () => {
  const s = runSummary(run([page(0, "两个字"), page(1, "two words here")]));
  expect(s.wordsSpoken).toBe(6);
});
