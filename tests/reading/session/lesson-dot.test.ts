// The dot on the phone's Learn button (src/reading/session/lesson-dot.ts,
// docs/77): pulsing while a reply is written, steady once one finished unseen,
// gone while the lesson is on screen. Run: bun test.

import { expect, test } from "bun:test";
import { lessonDot, seenReplyTs, type LessonDotCall } from "../../../src/reading/session/lesson-dot";

const ASKED = { role: "user" as const, ts: 1 };
const REPLY = { role: "ai" as const, ts: 2 };
const WRITING = { role: "ai" as const, ts: 4, streaming: true };

function lesson(view: LessonDotCall["view"], messages: LessonDotCall["messages"]): LessonDotCall {
  return { isBook: true, view, messages };
}

test("no lesson open is no dot", () => {
  expect(lessonDot(null, null)).toBeNull();
});

test("the lesson on screen shows no dot, whatever it is doing", () => {
  expect(lessonDot(lesson("chat-main", [ASKED, WRITING]), null)).toBeNull();
});

test("a reply being written while the page is up pulses", () => {
  expect(lessonDot(lesson("chat-pip", [ASKED, REPLY, { role: "user", ts: 3 }, WRITING]), 2)).toBe(
    "writing",
  );
});

test("a reply that finished after the reader left is unseen until they come back", () => {
  // Left mid-reply: what was seen is the reply before the one being written.
  const inLesson = lesson("chat-main", [ASKED, REPLY, { role: "user", ts: 3 }, WRITING]);
  const seen = seenReplyTs(null, inLesson);
  expect(seen).toBe(2);

  const done = { role: "ai" as const, ts: 4 };
  const onPage = lesson("chat-pip", [ASKED, REPLY, { role: "user", ts: 3 }, done]);
  // On the page nothing moves the mark.
  expect(seenReplyTs(seen, onPage)).toBe(2);
  expect(lessonDot(onPage, seen)).toBe("unseen");

  // Back in the lesson, it has been seen, and the page shows nothing after.
  const back = seenReplyTs(seen, { ...onPage, view: "chat-main" });
  expect(back).toBe(4);
  expect(lessonDot(onPage, back)).toBeNull();
});

test("leaving after the reply is read leaves no dot", () => {
  const read = seenReplyTs(null, lesson("chat-main", [ASKED, REPLY]));
  expect(lessonDot(lesson("chat-pip", [ASKED, REPLY]), read)).toBeNull();
});

test("a conversation that is not the lesson never lights the Learn button", () => {
  const aside: LessonDotCall = { view: "chat-pip", messages: [ASKED, WRITING] };
  expect(lessonDot(aside, null)).toBeNull();
  expect(seenReplyTs(7, { ...aside, view: "chat-main" })).toBe(7);
});
