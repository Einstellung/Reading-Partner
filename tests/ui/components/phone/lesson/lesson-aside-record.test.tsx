// When the lesson's aside is written down (docs/74): on its first question, and
// not on the press that opened the view. A reader who held a paragraph, saw the
// aside and went straight back has changed nothing — no record, no receipt row
// on the lesson. Run: bun test.

import { afterEach, expect, test } from "bun:test";

import {
  appendMessage,
  createBookThread,
  getThread,
  threadKind,
} from "../../../../../src/platform/app/threads";
import { useDom } from "../../../../support/dom";

const { act, cleanup, renderHook } = await useDom();
const { useLessonAside } = await import(
  "../../../../../src/ui/components/phone/lesson/use-lesson-aside"
);

afterEach(cleanup);

const SPAN = "Self-attention relates every position to every other.";

// A lesson with one reply in it, and the hook watching that conversation.
function lesson(bookId: string) {
  const parent = createBookThread(bookId, `bt-${bookId}`);
  appendMessage(bookId, parent.id, { role: "ai", text: "First stop.", ts: 100 });
  const view = renderHook(() => useLessonAside(bookId, parent.id));
  return { parent, view };
}

test("the view opens on nothing written down, and leaving writes nothing", () => {
  const bookId = "/books/aside-free.pdf";
  const { parent, view } = lesson(bookId);

  act(() => view.result.current.ask({ messageTs: 100, text: SPAN }));
  const open = view.result.current.open;
  expect(open?.span).toBe(SPAN);
  // The id is settled — the conversation cannot change under the view — but
  // there is no conversation yet.
  expect(open?.threadId).toBeTruthy();
  expect(getThread(bookId, open!.threadId)).toBeUndefined();

  act(() => view.result.current.back());
  expect(view.result.current.open).toBeNull();
  expect(getThread(bookId, open!.threadId)).toBeUndefined();
  // And no receipt row on the lesson: nothing happened to report.
  expect(getThread(bookId, parent.id)?.messages).toHaveLength(1);
});

test("the first question writes it down, and then it leaves its line", () => {
  const bookId = "/books/aside-asked.pdf";
  const { parent, view } = lesson(bookId);

  act(() => view.result.current.ask({ messageTs: 100, text: SPAN }));
  const threadId = view.result.current.open!.threadId;

  // What the aside's own turn does before it appends the reader's line
  // (use-lesson-call.ts send).
  act(() => view.result.current.ensure());
  const own = getThread(bookId, threadId);
  expect(own).toBeDefined();
  expect(threadKind(own!)).toBe("aside");
  expect(own!.parentThreadId).toBe(parent.id);
  // Idempotent: a second question does not write a second record.
  const ts = own!.createdAt;
  act(() => view.result.current.ensure());
  expect(getThread(bookId, threadId)?.createdAt).toBe(ts);

  appendMessage(bookId, threadId, { role: "user", text: "What is a head?", ts: 200 });
  act(() => view.result.current.back());
  expect(getThread(bookId, parent.id)?.messages).toHaveLength(2);
});
