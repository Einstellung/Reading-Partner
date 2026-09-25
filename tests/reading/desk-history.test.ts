// The replayed half of a reading turn (src/reading/desk-history.ts): the trim,
// the stand-in opening ask, where the page images ride, and the pass the trim
// fires. Run: bun test.

import { expect, test } from "bun:test";
import {
  composeMessages,
  historyKeep,
  replayedLesson,
  trimDistillOptions,
  HISTORY_KEEP,
  HISTORY_KEEP_TIGHT,
  type ReadingTurnMessage,
  type ReplayInput,
  type TrimDistillThread,
} from "../../src/reading/desk-history";
import { ASIDE_KICKOFF } from "../../src/reading/aside";
import { EXPLAIN_KICKOFF } from "../../src/reading/intents";
import type { PageWindowPlan } from "../../src/reading/figures/page-window";

const user = (text: string): ReadingTurnMessage => ({ role: "user", text });
const ai = (text: string): ReadingTurnMessage => ({ role: "ai", text });

function replay(over: Partial<ReplayInput> = {}): ReadingTurnMessage[] {
  return composeMessages({
    parentTail: [],
    prior: [],
    keep: HISTORY_KEEP,
    aside: false,
    pageWindow: null,
    ...over,
  });
}

test("the tight rung shortens the history, nothing else does", () => {
  expect(historyKeep(new Set())).toBe(HISTORY_KEEP);
  expect(historyKeep(new Set(["page-window"]))).toBe(HISTORY_KEEP);
  expect(historyKeep(new Set(["history-trim"]))).toBe(HISTORY_KEEP_TIGHT);
});

test("the parent's stretch is what the trim cuts first", () => {
  expect(replayedLesson(4, 2, 40)).toBe(4);
  expect(replayedLesson(4, 4, 6)).toBe(2);
  expect(replayedLesson(4, 6, 6)).toBe(0);
  expect(replayedLesson(0, 3, 6)).toBe(0);
});

test("a history that opens on the reader is replayed as it stands", () => {
  expect(replay({ prior: [user("q"), ai("a")] })).toEqual([user("q"), ai("a")]);
});

test("a history that opens on a reply gets the stand-in ask for its kind of thread", () => {
  expect(replay({ prior: [ai("a")] })[0]).toEqual(user(EXPLAIN_KICKOFF));
  expect(replay({ prior: [ai("a")], aside: true })[0]).toEqual(user(ASIDE_KICKOFF));
  expect(replay()).toEqual([user(EXPLAIN_KICKOFF)]);
});

test("parent tail, own messages and the trailing bell are joined, then trimmed from the front", () => {
  const out = replay({
    parentTail: [user("p1"), ai("p2")],
    prior: [user("m1"), ai("m2")],
    trailing: user("bell"),
    keep: 4,
  });
  expect(out.map((m) => m.text)).toEqual([EXPLAIN_KICKOFF, ai("p2").text, "m1", "m2", "bell"]);
});

test("the page images ride the last user message only", () => {
  const plan: PageWindowPlan = {
    anchor: 5,
    gate: "figures",
    pages: [{ page: 5, widthPx: 800, anchor: true }],
  };
  const images = [{ data: "AAA", mediaType: "image/png" }];
  const out = replay({ prior: [user("q1"), ai("a1"), user("q2")], pageWindow: { plan, images } });
  expect(out[2].images).toEqual(images);
  expect(out[0].images).toBeUndefined();
  expect(out[0].text.startsWith("q1\n\n")).toBe(true);
  expect(replay({ prior: [user("q")] })[0].images).toBeUndefined();
});

const base: TrimDistillThread = {
  topicId: "t1",
  topicName: "Topic",
  bookId: "book",
  bookName: "Book.pdf",
  threadId: "th-mark",
  annotationId: "ann-1",
  page: 12,
  currentPage: 30,
  selectionText: "the marked passage",
  messages: [
    { id: "m1", role: "user", text: "q", ts: 1 },
    { role: "ai", text: "a", ts: 2 },
  ],
};

test("a thread that is its own unit is distilled as itself", () => {
  const opts = trimDistillOptions(base, [], []);
  expect(opts).toEqual({
    topicId: "t1",
    topicName: "Topic",
    bookId: "book",
    bookName: "Book.pdf",
    threadId: "th-mark",
    trigger: "trim",
    annotationId: "ann-1",
    page: 12,
    markedText: "the marked passage",
    messages: [
      { id: "m1", role: "user", text: "q", ts: 1 },
      { role: "ai", text: "a", ts: 2 },
    ],
    annotations: [],
  });
});

test("a chat-span aside folds into the lesson, at the reader's page and with no passage", () => {
  const lesson = { id: "lesson", annotationId: "", messages: [{ role: "user" as const, text: "l", ts: 1 }] };
  const aside = {
    id: "th-aside",
    annotationId: "",
    parentThreadId: "lesson",
    messages: [{ role: "user" as const, text: "s", ts: 2 }],
  };
  const opts = trimDistillOptions(
    { ...base, threadId: "th-aside", annotationId: "" },
    [lesson, aside],
    [],
  );
  expect(opts.threadId).toBe("lesson");
  expect(opts.annotationId).toBe("");
  expect(opts.page).toBe(30);
  expect(opts.markedText).toBe("");
  expect(opts.parts?.length).toBeGreaterThan(0);
});
