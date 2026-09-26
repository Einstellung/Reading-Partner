// The reader talking while the answer is still being written (docs/72), in the
// session that has to do something with it: it is not a second turn, and it is
// not the stop button. The model call is a spy, so what this drives is the
// hook's side — which row is drawn when, what the thread file ends up holding,
// and what happens to a line the model was never handed.
//
// Same setup as use-call-open.test.tsx: static imports (pitfall 121).
import { afterEach, expect, spyOn, test } from "bun:test";
import { useCall } from "../../../src/reading/session/use-call";
import { resetReadingTurns } from "../../../src/reading/live-turns";
import * as agent from "../../../src/legion/execute/turn";
import * as threads from "../../../src/platform/app/threads";
import * as turn from "../../../src/reading/turn";
import type { RunAgentTurnOptions, SteerPort } from "../../../src/legion/execute/contract";
import type { CallRow } from "../../../src/reading/call-state";
import type { StagedImage } from "../../../src/reading/pending-images";
import type { Thread, ThreadMessage } from "../../../src/platform/app/threads";
import { useDom } from "../../support/dom";
import { CALL_BOOK as BOOK, callHost as host, emptyReadingTurn } from "../../support/use-call";

const { act, cleanup, renderHook } = await useDom();
afterEach(cleanup);
afterEach(resetReadingTurns);

const THREAD = "t1";
const MARK = "mark-1";

// One turn in flight, with its callbacks in hand. A steer port is handed out
// the way the harness hands one out: it records what it was asked to queue and
// the caller decides when the model is told it landed.
interface Rig {
  stored: ThreadMessage[];
  options: () => RunAgentTurnOptions;
  first: () => RunAgentTurnOptions;
  queued: string[];
  inject: (index: number) => void;
  turns: () => number;
  restore: () => void;
}

function rig(): Rig {
  const stored: ThreadMessage[] = [];
  const queued: string[] = [];
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
        const text = typeof message === "string" ? message : message.text;
        queued.push(text);
        return { ok: true, id: `e${queued.length}` };
      };
      options.onSteerable?.(port);
      return new Promise<void>(() => {}); // still writing, for as long as the test wants
    }),
  ];
  return {
    stored,
    options: () => calls[calls.length - 1],
    first: () => calls[0],
    queued,
    inject: (index) => calls[calls.length - 1].onSteered?.([`e${index + 1}`]),
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

test("a line said mid-answer steers the turn instead of starting a second one", async () => {
  const r = rig();
  try {
    const view = await mounted(r);
    act(() => r.options().onDelta("because"));

    await act(async () => {
      view.result.current.send("and the other one?");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // No second turn, and nothing was aborted.
    expect(r.turns()).toBe(1);
    expect(r.options().signal?.aborted).toBe(false);
    expect(r.queued).toEqual(["and the other one?"]);

    // On screen under the reply still being written, marked as waiting.
    expect(rows(view).map((m) => [m.role, m.text, m.queued])).toEqual([
      ["user", "why this?", undefined],
      ["ai", "because", undefined],
      ["user", "and the other one?", true],
    ]);
    expect(rows(view)[1].streaming).toBe(true);
    // Not in the thread file: the model has not been handed it yet.
    expect(r.stored.map((m) => m.text)).toEqual(["why this?"]);
  } finally {
    r.restore();
  }
});

test("the model handed the line: the file reads user / ai / user / ai and a new row opens", async () => {
  const r = rig();
  try {
    const view = await mounted(r);
    act(() => r.options().onDelta("because"));
    await act(async () => {
      view.result.current.send("and the other one?");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    act(() => r.inject(0));
    // The mark is off, and both lines are down in the order they happened.
    expect(rows(view)[2].queued).toBeUndefined();
    expect(r.stored.map((m) => [m.role, m.text])).toEqual([
      ["user", "why this?"],
      ["ai", "because"],
      ["user", "and the other one?"],
    ]);

    // What the model writes next is a row of its own, under the reader's line.
    act(() => r.options().onDelta("the other one is"));
    expect(rows(view).map((m) => [m.role, m.text])).toEqual([
      ["user", "why this?"],
      ["ai", "because"],
      ["user", "and the other one?"],
      ["ai", "the other one is"],
    ]);
    expect(rows(view)[1].streaming).toBeUndefined();

    // `turnText` is every round's words joined, the head included
    // (ai/turn-view/turn-rows.ts); what goes in the file is what is not already there.
    act(() =>
      r.options().onDone(
        "the other one is the 1962 figure",
        undefined,
        "because\n\nthe other one is the 1962 figure",
      ),
    );
    // Only the tail is persisted: the row above it is already in the file.
    expect(r.stored.map((m) => [m.role, m.text])).toEqual([
      ["user", "why this?"],
      ["ai", "because"],
      ["user", "and the other one?"],
      ["ai", "the other one is the 1962 figure"],
    ]);
  } finally {
    r.restore();
  }
});

test("stopping keeps the half sentence and opens the next turn with what was never sent", async () => {
  const r = rig();
  try {
    const view = await mounted(r);
    act(() => r.options().onDelta("because the mark"));
    await act(async () => {
      view.result.current.send("never mind, the other one?");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      view.result.current.stop();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(r.first().signal?.aborted).toBe(true);
    // The partial, then the line the model never saw, then a turn for it.
    expect(r.stored.map((m) => [m.role, m.text])).toEqual([
      ["user", "why this?"],
      ["ai", "because the mark"],
      ["user", "never mind, the other one?"],
    ]);
    expect(r.turns()).toBe(2);
    expect(rows(view).find((m) => m.text === "never mind, the other one?")?.queued).toBeUndefined();
  } finally {
    r.restore();
  }
});

test("an answer that landed before the queue drained is followed by a turn for it", async () => {
  const r = rig();
  try {
    const view = await mounted(r);
    act(() => r.options().onDelta("because"));
    await act(async () => {
      view.result.current.send("and the other one?");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      r.options().onDone("because the mark is there", undefined, "because the mark is there");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(r.stored.map((m) => [m.role, m.text])).toEqual([
      ["user", "why this?"],
      ["ai", "because the mark is there"],
      ["user", "and the other one?"],
    ]);
    expect(r.turns()).toBe(2);
  } finally {
    r.restore();
  }
});
