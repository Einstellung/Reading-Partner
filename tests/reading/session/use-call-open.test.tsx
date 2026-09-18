// Opening a conversation sends nothing (docs/03). A mark used to be read as
// "explain this" and the bubble fired that turn before the reader had said a
// word; now the empty bubble offers the opening intents and waits. The hook is
// the only place that can be seen from — the chips are render, and what is
// under test is that nothing reaches the model.
//
// Same setup as use-call-hangup.test.tsx: the hook needs a document, and the
// application modules are imported statically because a module first evaluated
// with a window in scope keeps whatever it decided about being in a browser
// (pitfall 121).
import { afterEach, expect, spyOn, test } from "bun:test";
import { useCall } from "../../../src/reading/session/use-call";
import { resetReadingTurns } from "../../../src/reading/live-turns";
import * as agent from "../../../src/legion/execute/turn";
import * as threads from "../../../src/platform/app/threads";
import * as turn from "../../../src/reading/turn";
import type { CallRow } from "../../../src/reading/call-state";
import type { StagedImage } from "../../../src/reading/pending-images";
import type { Thread, ThreadMessage } from "../../../src/platform/app/threads";
import { useDom } from "../../support/dom";
import { CALL_BOOK as BOOK, callHost as host, emptyReadingTurn } from "../../support/use-call";

const { act, cleanup, renderHook } = await useDom();
afterEach(cleanup);
// The registry of running turns is a module, so a turn a test leaves streaming
// is still on its thread when the next file mounts the hook (docs/pitfall/359).
afterEach(resetReadingTurns);

const THREAD = "t1";
const MARK = "mark-1";

// A provider is configured and the thread is empty — the exact case that used to
// fire the explain kickoff on its own.
test("opening an empty thread assembles no turn and leaves the conversation empty", async () => {
  const buildReadingTurn = spyOn(turn, "buildReadingTurn");
  const runAgentTurn = spyOn(agent, "runAgentTurn");
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    act(() => {
      view.result.current.openThread(
        { threadId: THREAD, annotationId: MARK, view: "bubble", anchor: { x: 0, y: 0 } },
        [],
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(buildReadingTurn).not.toHaveBeenCalled();
    expect(runAgentTurn).not.toHaveBeenCalled();
    // Empty is what the shell keys the intent chips (and the no-provider
    // guidance) off, so it has to stay empty rather than gaining a streaming row.
    expect(view.result.current.call?.messages).toEqual([]);
  } finally {
    buildReadingTurn.mockRestore();
    runAgentTurn.mockRestore();
  }
});

// The book-level thread (top-bar AI button) went down the same path, and its
// kickoff spoke of a passage it does not have.
test("opening the empty book-level thread assembles no turn either", async () => {
  const buildReadingTurn = spyOn(turn, "buildReadingTurn");
  const runAgentTurn = spyOn(agent, "runAgentTurn");
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    act(() => {
      view.result.current.openThread(
        { threadId: THREAD, annotationId: "", isBook: true, view: "chat-main", anchor: { x: 0, y: 0 } },
        [],
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(buildReadingTurn).not.toHaveBeenCalled();
    expect(runAgentTurn).not.toHaveBeenCalled();
  } finally {
    buildReadingTurn.mockRestore();
    runAgentTurn.mockRestore();
  }
});

// Picking a chip is an ordinary send: the reader's line goes into the thread and
// the turn runs on it.
test("picking an intent sends it like anything else the reader types", async () => {
  const stored: ThreadMessage[] = [];
  const getThread = spyOn(threads, "getThread").mockImplementation((bookId, threadId) =>
    bookId === BOOK && threadId === THREAD
      ? ({ id: THREAD, messages: stored.slice() } as Thread)
      : undefined,
  );
  const appendMessage = spyOn(threads, "appendMessage").mockImplementation(
    (_bookId, _threadId, message) => void stored.push(message),
  );
  const buildReadingTurn = spyOn(turn, "buildReadingTurn").mockResolvedValue(emptyReadingTurn());
  const runAgentTurn = spyOn(agent, "runAgentTurn").mockImplementation(
    () => new Promise<void>(() => {}),
  );
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    act(() => {
      view.result.current.openThread(
        { threadId: THREAD, annotationId: MARK, view: "bubble", anchor: { x: 0, y: 0 } },
        [],
      );
    });
    await act(async () => {
      view.result.current.send(turn.EXPLAIN_KICKOFF);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(stored.map((m) => [m.role, m.text])).toEqual([["user", turn.EXPLAIN_KICKOFF]]);
    expect(runAgentTurn).toHaveBeenCalledTimes(1);
  } finally {
    getThread.mockRestore();
    appendMessage.mockRestore();
    buildReadingTurn.mockRestore();
    runAgentTurn.mockRestore();
  }
});
