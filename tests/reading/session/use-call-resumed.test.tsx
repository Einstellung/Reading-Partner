// A thread opened with a turn already in flight that this session did not
// start — after a restart, the one recovery resumed (docs/soul/87, "被杀之后").
// The reader sees it stream, Stop reaches it, a line said into it steers it,
// and a line said while it lands (no run left to take it) waits for it to
// settle and then opens the next turn instead of failing. The turn is the
// stand-in from tests/support/use-call.ts; finding and following the real one
// is tests/reading/turn/durable-resumed.test.ts.
//
// Same setup as use-call-steer.test.tsx: static imports (pitfall 121).
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
const ASKED = 1000;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function rig() {
  const stored: ThreadMessage[] = [{ role: "user", text: "why this?", ts: ASKED }];
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
    book,
    restore: () => {
      spies.forEach((s) => s.mockRestore());
      book.restore();
    },
  };
}
type Rig = ReturnType<typeof rig>;

function render() {
  return renderHook(() => useCall<CallRow, StagedImage>(host()));
}
type View = ReturnType<typeof render>;
const open = (view: View, r: Rig) =>
  view.result.current.openThread({ threadId: THREAD, annotationId: MARK, view: "bubble", anchor: { x: 0, y: 0 } }, r.stored.slice());

// Opened while the runtime has a turn in flight on the thread, its rows after `ASKED`.
async function joined(r: Rig) {
  r.book.inFlight(ASKED);
  const view = render();
  await act(async () => {
    open(view, r);
    await tick();
  });
  expect(r.book.turns).toHaveLength(1);
  expect(r.book.last().resumed).toEqual({ home: BOOK, threadId: THREAD });
  return view;
}

const rows = (view: View) => view.result.current.call!.messages;
const shape = (view: View) => rows(view).map((m) => [m.role, m.text, m.queued ?? false]);
async function settle(fn: () => void) {
  await act(async () => {
    fn();
    await tick();
  });
}
const ai = (ts: number, text: string, over: Partial<CallRow> = {}): CallRow => ({ role: "ai", text, ts, ...over });

test("a thread with nothing in flight opens as it was, with no turn", async () => {
  const r = rig();
  try {
    const view = render();
    await settle(() => open(view, r));
    expect(r.book.lookups).toEqual([{ home: BOOK, threadId: THREAD }]);
    expect(r.book.turns).toHaveLength(0);
    expect(view.result.current.isAnswering(THREAD)).toBe(false);
    expect(shape(view)).toEqual([["user", "why this?", false]]);
  } finally {
    r.restore();
  }
});

test("a turn in flight streams on the thread, and Stop reaches it", async () => {
  const r = rig();
  try {
    const view = await joined(r);
    expect(view.result.current.isAnswering(THREAD)).toBe(true);
    await settle(() => r.book.last().view([ai(ASKED + 1, "because the moon", { streaming: true })]));
    expect(shape(view)).toEqual([
      ["user", "why this?", false],
      ["ai", "because the moon", false],
    ]);
    expect(rows(view)[1]!.streaming).toBe(true);

    await settle(() => view.result.current.stop());
    expect(r.book.last().stops).toBe(1);
    expect(view.result.current.isAnswering(THREAD)).toBe(true);
    await settle(() => r.book.last().end({ kind: "stopped", rows: [ai(ASKED + 1, "because the moon")], steers: [] }));
    expect(view.result.current.isAnswering(THREAD)).toBe(false);
    expect(shape(view)).toEqual([
      ["user", "why this?", false],
      ["ai", "because the moon", false],
    ]);
    expect(rows(view)[1]!.streaming).toBeFalsy();
    // The runtime lands what it said; the session writes nothing and starts nothing.
    expect(r.stored).toHaveLength(1);
    expect(r.book.turns).toHaveLength(1);
  } finally {
    r.restore();
  }
});

test("a line said into it steers it instead of starting a second turn", async () => {
  const r = rig();
  try {
    const view = await joined(r);
    await settle(() => r.book.last().view([ai(ASKED + 1, "because", { streaming: true })]));
    await settle(() => view.result.current.send("and the sun?"));
    expect(r.book.turns).toHaveLength(1);
    expect(r.book.last().steered.map((s) => s.text)).toEqual(["and the sun?"]);
    expect(shape(view)).toEqual([
      ["user", "why this?", false],
      ["ai", "because", false],
      ["user", "and the sun?", true],
    ]);
    const line = r.book.last().steered[0]!;
    await settle(() =>
      r.book.last().end({
        kind: "answered",
        rows: [ai(ASKED + 1, "because"), { role: "user", text: line.text, ts: line.ts }, ai(line.ts + 1, "the sun too")],
      }),
    );
    expect(shape(view)).toEqual([
      ["user", "why this?", false],
      ["ai", "because", false],
      ["user", "and the sun?", false],
      ["ai", "the sun too", false],
    ]);
    expect(r.stored).toHaveLength(1);
    expect(r.book.turns).toHaveLength(1);
  } finally {
    r.restore();
  }
});

test("a line said while it lands waits for it and then opens the next turn", async () => {
  const r = rig();
  try {
    const view = await joined(r);
    // Landing: the rows are all there and no run is left to take a line.
    await settle(() => r.book.last().view([ai(ASKED + 1, "because the moon")]));
    r.book.last().taking = false;
    await settle(() => view.result.current.send("and the sun?"));
    expect(r.book.turns).toHaveLength(1);
    expect(shape(view)).toEqual([
      ["user", "why this?", false],
      ["ai", "because the moon", false],
      ["user", "and the sun?", true],
    ]);

    await settle(() => r.book.last().end({ kind: "answered", rows: [ai(ASKED + 1, "because the moon")] }));
    // No failure: the line goes into the file after what landed, and a turn opens for it.
    expect(r.stored.map((m) => [m.role, m.text])).toEqual([
      ["user", "why this?"],
      ["user", "and the sun?"],
    ]);
    expect(r.book.turns).toHaveLength(2);
    expect(r.book.last().resumed).toBeUndefined();
    expect(r.book.last().request.line).toEqual({ text: "and the sun?", ts: r.stored[1]!.ts });
    expect(shape(view)).toEqual([
      ["user", "why this?", false],
      ["ai", "because the moon", false],
      ["user", "and the sun?", false],
      ["ai", "", false],
    ]);
    expect(rows(view)[3]!.streaming).toBe(true);
  } finally {
    r.restore();
  }
});

test("a line said before the runtime has answered goes into the turn in flight", async () => {
  const r = rig();
  try {
    r.book.inFlight(ASKED);
    const view = render();
    act(() => open(view, r));
    // Same task: the runtime has not answered yet.
    act(() => view.result.current.send("and the sun?"));
    expect(r.book.turns).toHaveLength(0);
    expect(r.stored).toHaveLength(1);
    await settle(() => {});
    // Not written and not asked as a turn of its own: it steered the one in flight.
    expect(r.book.turns).toHaveLength(1);
    expect(r.book.last().resumed).toBeDefined();
    expect(r.book.last().steered.map((s) => s.text)).toEqual(["and the sun?"]);
    expect(r.stored).toHaveLength(1);
  } finally {
    r.restore();
  }
});
