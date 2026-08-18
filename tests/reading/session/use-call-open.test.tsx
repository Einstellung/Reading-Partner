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
import { DEFAULT_SETTINGS, type Settings } from "../../../src/platform/app/settings";
import * as agent from "../../../src/ai/agent";
import * as threads from "../../../src/platform/app/threads";
import * as turn from "../../../src/reading/turn";
import type { CallRow } from "../../../src/reading/call-state";
import type { StagedImage } from "../../../src/reading/pending-images";
import type { Thread, ThreadMessage } from "../../../src/platform/app/threads";
import { useDom } from "../../support/dom";

const { act, cleanup, renderHook } = await useDom();
afterEach(cleanup);

const BOOK = "book-1";
const THREAD = "t1";
const MARK = "mark-1";

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultProviderId: "anthropic",
  defaultModelId: "some-model",
};

function host(): Parameters<typeof useCall<CallRow, StagedImage>>[0] {
  return {
    bookIdRef: { current: BOOK },
    ctxRef: {
      current: {
        topicId: "topic-1",
        topicName: "A Topic",
        fileName: "A Book.pdf",
        pageLabel: null,
        pageIndex: 4,
        files: [],
      },
    },
    settingsRef: { current: settings },
    annsRef: { current: new Map() },
    currentFulltextRef: { current: null },
    currentFiguresRef: { current: null },
    bufferRef: { current: null },
    classroomRef: { current: false },
    pipelineRef: { current: null },
    pushToast: () => {},
    distillAnnotations: () => [],
    removeMark: () => {},
    toDisplay: (stored: ThreadMessage[]) => stored as CallRow[],
    newRow: (row: CallRow) => row,
    maxImages: 3,
    imageLimitHint: "",
    loadingImage: (id: string) => ({ id }),
    readyImage: (id: string) => ({ id }),
    sendableImages: () => [],
  };
}

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
  const buildReadingTurn = spyOn(turn, "buildReadingTurn").mockResolvedValue({
    systemPrompt: "",
    tools: [],
    messages: [],
    classroom: false,
    notice: "",
    refusal: "",
  });
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
