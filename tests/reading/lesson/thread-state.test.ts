import { expect, test } from "bun:test";

import {
  lastCitedPage,
  lessonResumed,
  taughtChapters,
} from "../../../src/reading/lesson/thread-state";
import type { Thread, ThreadMessage } from "../../../src/platform/app/threads";
import { readChapterLabel } from "../../../src/reading/lecture/tools";

function thread(messages: ThreadMessage[]): Thread {
  return { id: "t1", annotationId: "", book: true, path: "b", createdAt: 0, messages };
}

function taughtMsg(chapter: number, state: "done" | "error" = "done"): ThreadMessage {
  return {
    role: "ai",
    text: "…",
    ts: 1,
    parts: [
      { type: "trace", tools: [{ name: "read_chapter", label: readChapterLabel(chapter), state }] },
    ],
  };
}

test("no thread has taught nothing", () => {
  expect(taughtChapters(undefined).size).toBe(0);
  expect(taughtChapters(thread([])).size).toBe(0);
});

test("every chapter read_chapter fetched is taught, once", () => {
  const t = thread([
    { role: "user", text: "go", ts: 0 },
    taughtMsg(1),
    taughtMsg(3),
    taughtMsg(3),
  ]);
  expect([...taughtChapters(t)].sort()).toEqual([1, 3]);
});

test("a chapter whose fetch errored still counts as visited", () => {
  expect([...taughtChapters(thread([taughtMsg(2, "error")]))]).toEqual([2]);
});

test("the page-range form of read_chapter names no chapter", () => {
  const t = thread([
    {
      role: "ai",
      text: "…",
      ts: 1,
      parts: [{ type: "trace", tools: [{ name: "read_chapter", label: "p.10-40", state: "done" }] }],
    },
  ]);
  expect(taughtChapters(t).size).toBe(0);
});

test("other tools are not chapters", () => {
  const t = thread([
    {
      role: "ai",
      text: "…",
      ts: 1,
      parts: [
        { type: "trace", tools: [{ name: "read_pages", label: "Reading chapter 9", state: "done" }] },
      ],
    },
  ]);
  expect(taughtChapters(t).size).toBe(0);
});

test("the last page the lesson quoted", () => {
  const msgs = [
    { role: "ai" as const, text: 'It opens on [p.2 "a claim"].' },
    { role: "user" as const, text: "and [p.99] of what?" },
    { role: "ai" as const, text: 'Then [p.7 "the result"] and [p.8 "the table"].' },
  ];
  expect(lastCitedPage(msgs)).toBe(8);
});

test("a reply with no citation does not blank the page", () => {
  const msgs = [
    { role: "ai" as const, text: 'See [p.5 "here"].' },
    { role: "user" as const, text: "I don't follow." },
    { role: "ai" as const, text: "Put another way, it is a ratio." },
  ];
  expect(lastCitedPage(msgs)).toBe(5);
});

test("a lesson that has quoted nothing has no page", () => {
  expect(lastCitedPage([{ role: "ai", text: "No pages named here." }])).toBe(null);
  expect(lastCitedPage([])).toBe(null);
});

test("only the reader's own brackets are not pages", () => {
  expect(lastCitedPage([{ role: "user", text: '[p.4 "mine"]' }])).toBe(null);
});

test("a resumed lesson is one with history and no turn yet", () => {
  const started = thread([{ role: "user", text: "go", ts: 0 }]);
  expect(lessonResumed(started, 0)).toBe(true);
  expect(lessonResumed(started, 1)).toBe(false);
  expect(lessonResumed(thread([]), 0)).toBe(false);
  expect(lessonResumed(undefined, 0)).toBe(false);
});
