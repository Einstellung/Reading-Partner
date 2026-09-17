// The hangup, driven through the hook that does it (src/reading/session/
// use-call.ts). What is pinned here is the call site: captureHangup hands
// deferHangup a `readStored` closure, and the whole point of a closure is that
// the thread file is read when the pass is built and not when the ✕ was
// pressed. Hoisting that read to a value read at hangup time — the shape B13
// shipped — leaves deferHangup's own tests green, because they hand it their own
// closure; only a test that goes through the hook can see it.
//
// The hook needs a document (renderHook mounts it), so the window goes up here
// and comes down with the file. The application modules are imported statically
// on purpose: a module first evaluated with a window in scope keeps whatever it
// decided about being in a browser for the rest of the run (pitfall 121), and
// none of these have any business deciding that here.
import { afterEach, expect, spyOn, test } from "bun:test";
import { useCall } from "../../../src/reading/session/use-call";
import * as agent from "../../../src/legion/execute/turn";
import * as events from "../../../src/platform/app/events";
import * as observation from "../../../src/memory";
import * as threads from "../../../src/platform/app/threads";
import * as turn from "../../../src/reading/turn";
import type { CallRow } from "../../../src/reading/call-state";
import type { StagedImage } from "../../../src/reading/pending-images";
import type { HangupPass } from "../../../src/reading/session/hangup";
import type { Thread, ThreadMessage } from "../../../src/platform/app/threads";
import { useDom } from "../../support/dom";
import { CALL_BOOK as BOOK, callHost as host, emptyReadingTurn } from "../../support/use-call";

const { act, cleanup, renderHook } = await useDom();
afterEach(cleanup);

const THREAD = "t1";
const MARK = "mark-1";

test("the thread the hangup distils is read when the turn lands, not when the ✕ was pressed", async () => {
  // The thread file, as the store holds it. getThread hands back a copy of it,
  // the way the real one hands back what it parsed — a caller that holds on to
  // the array it was given is holding a snapshot, which is the whole question
  // here.
  const stored: ThreadMessage[] = [
    { role: "user", text: "what is this mark about?", ts: 1 },
    { role: "ai", text: "the 1962 figure", ts: 2 },
  ];
  const getThread = spyOn(threads, "getThread").mockImplementation((bookId, threadId) =>
    bookId === BOOK && threadId === THREAD
      ? ({ id: THREAD, messages: stored.slice() } as Thread)
      : undefined,
  );
  // The reply landing writes itself into the thread file. That write is the
  // reason the read has to wait for it.
  const appendMessage = spyOn(threads, "appendMessage").mockImplementation(
    (_bookId, _threadId, message) => void stored.push(message),
  );
  const logEvent = spyOn(events, "logEvent").mockImplementation(() => {});
  const distilled: HangupPass[] = [];
  const distillThread = spyOn(observation, "distillThread").mockImplementation(
    async (pass) => void distilled.push(pass as unknown as HangupPass),
  );
  // The turn's assembly and the model call, which this test has nothing to say
  // about: the turn is only here to be in flight.
  const buildReadingTurn = spyOn(turn, "buildReadingTurn").mockResolvedValue(emptyReadingTurn());
  let onDone: ((full: string) => void) | undefined;
  const runAgentTurn = spyOn(agent, "runAgentTurn").mockImplementation((options) => {
    onDone = options.onDone;
    return new Promise<void>(() => {}); // still writing, for as long as this test wants
  });

  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));

    act(() => {
      view.result.current.openThread(
        { threadId: THREAD, annotationId: MARK, view: "bubble", anchor: { x: 0, y: 0 } },
        stored.slice(),
      );
    });
    // The exchange the reader is about to hang up in the middle of.
    await act(async () => {
      view.result.current.send("why?");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(runAgentTurn).toHaveBeenCalledTimes(1);
    expect(onDone).toBeDefined();

    // The ✕, mid-answer. Nothing may have been read off the thread yet: what is
    // there now is a question with no answer under it.
    getThread.mockClear();
    act(() => view.result.current.hangUp());
    expect(getThread).not.toHaveBeenCalled();
    expect(distilled).toEqual([]);

    // The reply lands and writes itself into the thread file, and only then is
    // the pass built.
    act(() => onDone?.("because the mark is on that page"));

    expect(getThread).toHaveBeenCalledTimes(1);
    expect(distilled).toHaveLength(1);
    // Each line stamped with the thread it is stored in, which is what an
    // anchor is built from (memory/observations/transcript.ts).
    expect(distilled[0]?.messages).toEqual([
      { role: "user", text: "what is this mark about?", ts: 1, threadId: "t1" },
      { role: "ai", text: "the 1962 figure", ts: 2, threadId: "t1" },
      { role: "user", text: "why?", ts: expect.any(Number), threadId: "t1" },
      {
        role: "ai",
        text: "because the mark is on that page",
        ts: expect.any(Number),
        threadId: "t1",
      },
    ]);
  } finally {
    getThread.mockRestore();
    appendMessage.mockRestore();
    logEvent.mockRestore();
    distillThread.mockRestore();
    buildReadingTurn.mockRestore();
    runAgentTurn.mockRestore();
  }
});
