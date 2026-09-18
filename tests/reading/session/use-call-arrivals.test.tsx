// A reply written into the conversation the reader has open, by something that
// is not the view (docs/68): the soul answers a delegated run into the thread it
// was sent from, and because the reader is looking at that thread no card is put
// in the box for it — so the row has to arrive on screen by itself.
//
// Same setup as use-call-open.test.tsx: the application modules are imported
// statically (pitfall 121) and the real thread store is used, which keeps its
// threads in memory.
import { afterEach, expect, spyOn, test } from "bun:test";
import { useCall } from "../../../src/reading/session/use-call";
import { resetReadingTurns } from "../../../src/reading/live-turns";
import * as agent from "../../../src/legion/execute/turn";
import { appendMessage, createThread, rebuildThreadStoreForTests } from "../../../src/platform/app/threads";
import * as turn from "../../../src/reading/turn";
import type { CallRow } from "../../../src/reading/call-state";
import type { StagedImage } from "../../../src/reading/pending-images";
import { useDom } from "../../support/dom";
import { CALL_BOOK as BOOK, callHost as host, emptyReadingTurn } from "../../support/use-call";

const { act, cleanup, renderHook } = await useDom();
afterEach(cleanup);
// The registry of running turns is a module, so a turn a test leaves streaming
// is still on its thread when the next file mounts the hook (docs/pitfall/359).
afterEach(resetReadingTurns);

const MARK = "mark-1";

function openCall(threadId: string) {
  rebuildThreadStoreForTests();
  createThread(BOOK, MARK, threadId);
  const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
  act(() => {
    view.result.current.openThread(
      { threadId, annotationId: MARK, view: "bubble", anchor: { x: 0, y: 0 } },
      [],
    );
  });
  return view;
}

test("a reply appended from outside the view shows up in the open conversation", () => {
  const view = openCall("t-arrive");
  act(() => {
    appendMessage(BOOK, "t-arrive", { role: "ai", text: "the run is done", ts: 11 });
  });

  expect(view.result.current.call?.messages.map((m) => m.text)).toEqual(["the run is done"]);
});

test("an append to another conversation leaves the open one alone", () => {
  const view = openCall("t-open");
  createThread(BOOK, MARK, "t-elsewhere");
  act(() => {
    appendMessage(BOOK, "t-elsewhere", { role: "ai", text: "not this one", ts: 12 });
  });

  expect(view.result.current.call?.messages).toEqual([]);
});

test("the reader's own message is not shown twice", async () => {
  const buildReadingTurn = spyOn(turn, "buildReadingTurn").mockResolvedValue(emptyReadingTurn());
  const runAgentTurn = spyOn(agent, "runAgentTurn").mockResolvedValue(undefined as never);
  try {
    const view = openCall("t-send");
    await act(async () => {
      view.result.current.send("why?");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // The question and the row the turn is writing into. The same append also
    // came back through the channel, and was recognised as this view's own.
    expect(view.result.current.call?.messages.map((m) => m.role)).toEqual(["user", "ai"]);
    expect(view.result.current.call?.messages.map((m) => m.text)).toEqual(["why?", ""]);
  } finally {
    buildReadingTurn.mockRestore();
    runAgentTurn.mockRestore();
  }
});
