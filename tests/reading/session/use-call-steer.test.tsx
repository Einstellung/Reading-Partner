// A reading turn on the durable runtime, from the session's side (docs/72,
// docs/soul/87): the reader talking while the answer is still being written is
// not a second turn and not the stop button, and every way a turn ends leaves
// the right rows on screen. The book turn is a stand-in the test drives
// (tests/support/use-call.ts), so this covers which rows are drawn when, what
// is handed to the runtime, and what happens to a line no run took. What the
// runtime projects and lands in the thread file is tested on its own
// (tests/reading/turn/durable-*.test.ts).
//
// Same setup as use-call-open.test.tsx: static imports (pitfall 121).
import { afterEach, expect, spyOn, test } from "bun:test";
import { useCall } from "../../../src/reading/session/use-call";
import { resetReadingTurns } from "../../../src/reading/turn/live-turns";
import * as threads from "../../../src/platform/app/threads";
import * as turn from "../../../src/reading/turn/turn";
import type { CallRow } from "../../../src/reading/turn/call-state";
import type { StagedImage } from "../../../src/reading/turn/pending-images";
import type { Thread, ThreadMessage } from "../../../src/platform/app/threads";
import { useDom } from "../../support/dom";
import { CALL_BOOK as BOOK, callHost as host, emptyReadingTurn, fakeBookTurns } from "../../support/use-call";

const { act, cleanup, renderHook } = await useDom();
afterEach(cleanup);
afterEach(resetReadingTurns);

const THREAD = "t1";
const MARK = "mark-1";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function rig() {
  const stored: ThreadMessage[] = [];
  const toasts: string[] = [];
  const book = fakeBookTurns();
  const spies = [
    spyOn(threads, "getThread").mockImplementation((bookId, threadId) =>
      bookId === BOOK && threadId === THREAD ? ({ id: THREAD, messages: stored.slice() } as Thread) : undefined,
    ),
    spyOn(threads, "appendMessage").mockImplementation((_bookId, _threadId, message) => void stored.push(message)),
    spyOn(turn, "buildReadingTurn").mockResolvedValue(emptyReadingTurn()),
  ];
  return {
    stored,
    toasts,
    book,
    spies,
    restore: () => {
      spies.forEach((s) => s.mockRestore());
      book.restore();
    },
  };
}
type Rig = ReturnType<typeof rig>;

async function mounted(r: Rig) {
  const view = renderHook(() =>
    useCall<CallRow, StagedImage>(host({ pushToast: (_kind, message) => void r.toasts.push(message) })),
  );
  act(() => {
    view.result.current.openThread({ threadId: THREAD, annotationId: MARK, view: "bubble", anchor: { x: 0, y: 0 } }, []);
  });
  await say(view, "why this?");
  expect(r.book.turns).toHaveLength(1);
  return view;
}

type View = Awaited<ReturnType<typeof mounted>>;
const rows = (view: View) => view.result.current.call!.messages;
const shape = (view: View) => rows(view).map((m) => [m.role, m.text, m.queued ?? false]);
async function say(view: { result: { current: { send(text: string): void } } }, text: string) {
  await act(async () => {
    view.result.current.send(text);
    await tick();
  });
}
async function settle(fn: () => void) {
  await act(async () => {
    fn();
    await tick();
  });
}
const ai = (ts: number, text: string, over: Partial<CallRow> = {}): CallRow => ({ role: "ai", text, ts, ...over });

test("the turn is asked with the reader's line as the file holds it, and a row streams at once", async () => {
  const r = rig();
  try {
    const view = await mounted(r);
    const { request } = r.book.last();
    expect(request.line).toEqual({ text: "why this?", ts: r.stored[0]!.ts });
    expect(request.model).toEqual({ provider: "anthropic", modelId: "some-model" });
    expect(request.origin).toMatchObject({ place: "book", bookId: BOOK, threadId: THREAD, home: BOOK });
    expect(shape(view)).toEqual([
      ["user", "why this?", false],
      ["ai", "", false],
    ]);
    expect(rows(view)[1]!.streaming).toBe(true);
  } finally {
    r.restore();
  }
});

test("a line said mid-answer steers the turn instead of starting a second one", async () => {
  const r = rig();
  try {
    const view = await mounted(r);
    const asked = r.stored[0]!.ts;
    await settle(() => r.book.last().view([ai(asked + 1, "because", { streaming: true })]));
    await say(view, "and the other one?");

    // No second turn, and nothing was stopped.
    expect(r.book.turns).toHaveLength(1);
    expect(r.book.last().stops).toBe(0);
    expect(r.book.last().steered.map((s) => s.text)).toEqual(["and the other one?"]);
    // On screen under the reply still being written, marked as waiting.
    expect(shape(view)).toEqual([
      ["user", "why this?", false],
      ["ai", "because", false],
      ["user", "and the other one?", true],
    ]);
    expect(rows(view)[1]!.streaming).toBe(true);
    // Not written by the session: the runtime lands it with the turn.
    expect(r.stored.map((m) => m.text)).toEqual(["why this?"]);
  } finally {
    r.restore();
  }
});

test("the runtime's view takes the line over: one copy, and unchanged rows stay the rows they were", async () => {
  const r = rig();
  try {
    const view = await mounted(r);
    const asked = r.stored[0]!.ts;
    await settle(() => r.book.last().view([ai(asked + 1, "because", { streaming: true })]));
    await say(view, "and the other one?");
    const line = r.book.last().steered[0]!;

    const handed = [
      ai(asked + 1, "because"),
      { role: "user" as const, text: line.text, ts: line.ts },
      ai(line.ts + 1, "the other one is", { streaming: true }),
    ];
    await settle(() => r.book.last().view(handed));
    expect(shape(view)).toEqual([
      ["user", "why this?", false],
      ["ai", "because", false],
      ["user", "and the other one?", false],
      ["ai", "the other one is", false],
    ]);

    // A token into the last row re-renders that row and nothing else.
    const above = rows(view)[1];
    await settle(() =>
      r.book.last().view([handed[0]!, handed[1]!, ai(line.ts + 1, "the other one is the 1962 figure", { streaming: true })]),
    );
    expect(rows(view)[1]).toBe(above);
    expect(rows(view)[3]!.text).toBe("the other one is the 1962 figure");
  } finally {
    r.restore();
  }
});

test("stopping keeps what the runtime kept and opens the next turn with what no run took", async () => {
  const r = rig();
  try {
    const view = await mounted(r);
    const asked = r.stored[0]!.ts;
    await settle(() => r.book.last().view([ai(asked + 1, "because the mark", { streaming: true })]));
    await say(view, "never mind, the other one?");
    const line = r.book.last().steered[0]!;

    await settle(() => view.result.current.stop());
    expect(r.book.last().stops).toBe(1);
    // Still answering until the runtime says the turn is over.
    expect(view.result.current.isAnswering(THREAD)).toBe(true);

    await settle(() => r.book.turns[0]!.end({ kind: "stopped", rows: [ai(asked + 1, "because the mark")], steers: [line] }));
    // The half sentence is the runtime's to land; the line the model never saw
    // is the session's, and a turn opens for it.
    expect(r.stored.map((m) => [m.role, m.text])).toEqual([
      ["user", "why this?"],
      ["user", "never mind, the other one?"],
    ]);
    expect(r.book.turns).toHaveLength(2);
    expect(r.book.last().request.line).toEqual({ text: line.text, ts: line.ts });
    expect(shape(view)).toEqual([
      ["user", "why this?", false],
      ["ai", "because the mark", false],
      ["user", "never mind, the other one?", false],
      ["ai", "", false],
    ]);
    expect(rows(view)[1]!.streaming).toBeFalsy();
  } finally {
    r.restore();
  }
});

test("an answer that landed before a run took the line is followed by a turn for it", async () => {
  const r = rig();
  try {
    const view = await mounted(r);
    const asked = r.stored[0]!.ts;
    r.book.last().taking = false;
    await settle(() => r.book.last().view([ai(asked + 1, "because", { streaming: true })]));
    await say(view, "and the other one?");

    await settle(() => r.book.turns[0]!.end({ kind: "answered", rows: [ai(asked + 1, "because the mark is there")] }));
    expect(r.stored.map((m) => [m.role, m.text])).toEqual([
      ["user", "why this?"],
      ["user", "and the other one?"],
    ]);
    expect(r.book.turns).toHaveLength(2);
    expect(shape(view).slice(0, 3)).toEqual([
      ["user", "why this?", false],
      ["ai", "because the mark is there", false],
      ["user", "and the other one?", false],
    ]);
  } finally {
    r.restore();
  }
});

const RECEIPT = { label: "Updated your profile", summary: "Prefers short answers" };
const PROFILE = { name: "profile_update", label: "Updating your profile", state: "done" as const, receipt: RECEIPT };

test("stopping a turn that wrote no word yet keeps its receipt on screen", async () => {
  const r = rig();
  try {
    const view = await mounted(r);
    const asked = r.stored[0]!.ts;
    await settle(() => view.result.current.stop());
    await settle(() =>
      r.book.last().end({ kind: "stopped", rows: [ai(asked + 1, "", { tools: [PROFILE] })], steers: [] }),
    );
    const last = rows(view)[rows(view).length - 1]!;
    expect([last.role, last.text, last.streaming, last.tools]).toEqual(["ai", "", undefined, [PROFILE]]);
    expect(view.result.current.isAnswering(THREAD)).toBe(false);
  } finally {
    r.restore();
  }
});

test("stopping a turn that produced nothing leaves no row", async () => {
  const r = rig();
  try {
    const view = await mounted(r);
    await settle(() => view.result.current.stop());
    await settle(() => r.book.last().end({ kind: "stopped", rows: [ai(r.stored[0]!.ts + 1, "")], steers: [] }));
    expect(rows(view).map((m) => m.role)).toEqual(["user"]);
  } finally {
    r.restore();
  }
});

test("a refusal is a notice with no Retry; a failure is an error row with Retry and a toast", async () => {
  const r = rig();
  try {
    const view = await mounted(r);
    await settle(() => r.book.last().end({ kind: "refused", rows: [], message: "That is too much to read at once." }));
    expect(view.result.current.call!.error).toBe(false);
    expect(rows(view)[rows(view).length - 1]!.failed).toBeFalsy();

    await settle(() => view.result.current.retry());
    expect(r.book.turns).toHaveLength(2);
    await settle(() => r.book.last().end({ kind: "failed", rows: [], message: "overloaded" }));
    const last = rows(view)[rows(view).length - 1]!;
    expect([last.role, last.failed]).toEqual(["ai", true]);
    expect(view.result.current.call!.error).toBe(true);
    expect(r.toasts.length).toBeGreaterThan(0);
  } finally {
    r.restore();
  }
});

test("a stalled turn is asked again once, and a second stall is shown as a failure", async () => {
  const r = rig();
  try {
    const view = await mounted(r);
    await settle(() => r.book.last().end({ kind: "stalled", steers: [] }));
    expect(r.book.turns).toHaveLength(2);
    // The dead turn's row went; the one asked again is streaming.
    expect(shape(view)).toEqual([
      ["user", "why this?", false],
      ["ai", "", false],
    ]);
    expect(rows(view)[1]!.streaming).toBe(true);

    await settle(() => r.book.last().end({ kind: "stalled", steers: [] }));
    expect(r.book.turns).toHaveLength(2);
    expect(rows(view)[rows(view).length - 1]!.failed).toBe(true);
  } finally {
    r.restore();
  }
});
