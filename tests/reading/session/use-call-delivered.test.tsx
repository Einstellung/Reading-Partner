// A run the soul delegated coming back while the turn that asked for it is
// still running (docs/72). The bell is put into that turn and nowhere else: no
// row on screen, no line in the thread file. What it leaves behind is the reply
// after it, marked with the run it answers.
//
// Same setup as use-call-steer.test.tsx: static imports (pitfall 121), a spy for
// the model call, and the turn left streaming for as long as the test wants.
import { afterEach, expect, spyOn, test } from "bun:test";
import { useCall } from "../../../src/reading/session/use-call";
import { resetReadingTurns } from "../../../src/reading/turn/live-turns";
import { deliverIntoReadingTurn } from "../../../src/reading/turn/deliver";
import * as agent from "../../../src/legion/execute/turn";
import * as threads from "../../../src/platform/app/threads";
import * as turn from "../../../src/reading/turn/turn";
import type { RunAgentTurnOptions, SteerMessage, SteerPort } from "../../../src/legion/execute/contract";
import type { CallRow } from "../../../src/reading/turn/call-state";
import type { StagedImage } from "../../../src/reading/turn/pending-images";
import type { Thread, ThreadMessage } from "../../../src/platform/app/threads";
import { useDom } from "../../support/dom";
import { CALL_BOOK as BOOK, callHost as host, emptyReadingTurn } from "../../support/use-call";

const { act, cleanup, renderHook } = await useDom();
afterEach(cleanup);
afterEach(resetReadingTurns);

const THREAD = "t1";
const MARK = "mark-1";
const origin = { place: "book", bookId: BOOK, threadId: THREAD } as const;

interface Rig {
  stored: ThreadMessage[];
  options: () => RunAgentTurnOptions;
  queued: SteerMessage[];
  /** The round boundary drained the message queued nth, whoever queued it. */
  land: (index: number) => void;
  turns: () => number;
  restore: () => void;
}

function rig(): Rig {
  const stored: ThreadMessage[] = [];
  const queued: SteerMessage[] = [];
  const internal = new Set<string>();
  const calls: RunAgentTurnOptions[] = [];
  const spies = [
    spyOn(threads, "getThread").mockImplementation((bookId, threadId) =>
      bookId === BOOK && threadId === THREAD
        ? ({ id: THREAD, messages: stored.slice() } as Thread)
        : undefined,
    ),
    spyOn(threads, "appendMessage").mockImplementation(
      (_bookId, _threadId, message) => void stored.push(message),
    ),
    spyOn(turn, "buildReadingTurn").mockResolvedValue(emptyReadingTurn()),
    spyOn(agent, "runAgentTurn").mockImplementation((options) => {
      calls.push(options);
      const port: SteerPort = async (message) => {
        const m: SteerMessage = typeof message === "string" ? { text: message } : message;
        queued.push(m);
        const id = `e${queued.length}`;
        if (m.internal) internal.add(id);
        return { ok: true, id };
      };
      options.onSteerable?.(port);
      return new Promise<void>(() => {});
    }),
  ];
  return {
    stored,
    options: () => calls[calls.length - 1],
    queued,
    land: (index) => {
      const id = `e${index + 1}`;
      const last = calls[calls.length - 1];
      if (internal.has(id)) last.onDelivered?.([id]);
      else last.onSteered?.([id]);
    },
    turns: () => calls.length,
    restore: () => spies.forEach((s) => s.mockRestore()),
  };
}

async function mounted(r: Rig) {
  const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
  act(() => {
    view.result.current.openThread(
      { threadId: THREAD, annotationId: MARK, view: "bubble", anchor: { x: 0, y: 0 } },
      [],
    );
  });
  await act(async () => {
    view.result.current.send("why this?");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(r.turns()).toBe(1);
  return view;
}

const rows = (view: { result: { current: { call: { messages: CallRow[] } | null } } }) =>
  view.result.current.call!.messages;

const bell = "[bell from legion — this was not said by the reader]\nA run you delegated has finished.";

test("a run delivered mid-answer goes into the turn and draws nothing", async () => {
  const r = rig();
  try {
    const view = await mounted(r);
    act(() => r.options().onDelta("because"));

    let handed: unknown = "pending";
    void deliverIntoReadingTurn({ origin, bell, runId: "r-1" }).then((v) => (handed = v));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // No second turn: the bell rides the one already running.
    expect(r.turns()).toBe(1);
    expect(r.queued).toEqual([{ text: bell, internal: true }]);
    // Nothing of it is on screen, and nothing of it is in the thread file.
    expect(rows(view).map((m) => [m.role, m.text])).toEqual([
      ["user", "why this?"],
      ["ai", "because"],
    ]);
    expect(r.stored.map((m) => m.text)).toEqual(["why this?"]);
    // Not answered yet: the model has only been handed it once the round
    // boundary drains the queue.
    expect(handed).toBe("pending");
  } finally {
    r.restore();
  }
});

test("the model handed it: the reply that follows is a row of its own, marked with the run", async () => {
  const r = rig();
  try {
    const view = await mounted(r);
    act(() => r.options().onDelta("because"));

    let handed: unknown;
    const waiting = deliverIntoReadingTurn({ origin, bell, runId: "r-1" }).then((v) => (handed = v));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => r.land(0));
    await act(async () => {
      await waiting;
    });
    // The reader has this conversation open, so no card goes in the box: they
    // are reading the delivery as it arrives (docs/68).
    expect(handed).toEqual({ threadId: THREAD, watching: true });

    // The words written before it are down; the reader's rows are untouched.
    expect(r.stored.map((m) => [m.role, m.text])).toEqual([
      ["user", "why this?"],
      ["ai", "because"],
    ]);

    act(() => r.options().onDelta("the literature is in"));
    expect(rows(view).map((m) => [m.role, m.text, m.origin])).toEqual([
      ["user", "why this?", undefined],
      ["ai", "because", undefined],
      ["ai", "the literature is in", { runId: "r-1" }],
    ]);

    act(() => r.options().onDone("the literature is in", undefined, "because\n\nthe literature is in"));
    expect(r.stored[r.stored.length - 1]).toEqual(
      expect.objectContaining({ role: "ai", text: "the literature is in", origin: { runId: "r-1" } }),
    );
  } finally {
    r.restore();
  }
});

test("handed it before a word was written: no empty row, and this row is the delivery", async () => {
  const r = rig();
  try {
    const view = await mounted(r);

    const waiting = deliverIntoReadingTurn({ origin, bell, runId: "r-9" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => r.land(0));
    await act(async () => {
      await waiting;
    });

    act(() => r.options().onDelta("the translation is in"));
    // One AI row, not two: an empty one above it would be the whole of what a
    // split left behind (pitfall 360).
    expect(rows(view).map((m) => [m.role, m.text])).toEqual([
      ["user", "why this?"],
      ["ai", "the translation is in"],
    ]);

    act(() => r.options().onDone("the translation is in", undefined, "the translation is in"));
    expect(r.stored.map((m) => [m.role, m.text, m.origin])).toEqual([
      ["user", "why this?", undefined],
      ["ai", "the translation is in", { runId: "r-9" }],
    ]);
  } finally {
    r.restore();
  }
});

test("a delivered row the reader then steers goes into the file still marked with the run", async () => {
  const r = rig();
  try {
    const view = await mounted(r);

    const waiting = deliverIntoReadingTurn({ origin, bell, runId: "r-9" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => r.land(0));
    await act(async () => {
      await waiting;
    });
    act(() => r.options().onDelta("the translation is in"));

    await act(async () => {
      view.result.current.send("and the footnotes?");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => r.land(1));

    expect(r.stored.map((m) => [m.role, m.text, m.origin])).toEqual([
      ["user", "why this?", undefined],
      ["ai", "the translation is in", { runId: "r-9" }],
      ["user", "and the footnotes?", undefined],
    ]);
  } finally {
    r.restore();
  }
});

test("stopped mid-reply to a run delivered mid-answer: the kept half is still marked with the run", async () => {
  const r = rig();
  try {
    const view = await mounted(r);
    act(() => r.options().onDelta("because"));
    const waiting = deliverIntoReadingTurn({ origin, bell, runId: "r-1" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => r.land(0));
    await act(async () => {
      await waiting;
    });
    act(() => r.options().onDelta("the literature"));

    await act(async () => {
      view.result.current.stop();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(r.stored.map((m) => [m.role, m.text, m.origin])).toEqual([
      ["user", "why this?", undefined],
      ["ai", "because", undefined],
      ["ai", "the literature", { runId: "r-1" }],
    ]);
  } finally {
    r.restore();
  }
});

test("stopped mid-reply to a run delivered before a word was written: the kept half is marked with the run", async () => {
  const r = rig();
  try {
    const view = await mounted(r);
    const waiting = deliverIntoReadingTurn({ origin, bell, runId: "r-9" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => r.land(0));
    await act(async () => {
      await waiting;
    });
    act(() => r.options().onDelta("the translation"));
    // Marked on screen while it is still being written, not only once reopened.
    expect(rows(view).map((m) => [m.role, m.text, m.origin])).toEqual([
      ["user", "why this?", undefined],
      ["ai", "the translation", { runId: "r-9" }],
    ]);

    await act(async () => {
      view.result.current.stop();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(r.stored.map((m) => [m.role, m.text, m.origin])).toEqual([
      ["user", "why this?", undefined],
      ["ai", "the translation", { runId: "r-9" }],
    ]);
  } finally {
    r.restore();
  }
});

test("a turn that ended before the boundary drained it answers no bell", async () => {
  const r = rig();
  try {
    const view = await mounted(r);
    act(() => r.options().onDelta("because"));
    const waiting = deliverIntoReadingTurn({ origin, bell, runId: "r-1" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => r.options().onDone("because", undefined, "because"));
    expect(await waiting).toBeNull();
    // The reply is the plain one, with nothing to say it answered a run.
    expect(r.stored[r.stored.length - 1]!.origin).toBeUndefined();
    expect(rows(view).length).toBe(2);
  } finally {
    r.restore();
  }
});
