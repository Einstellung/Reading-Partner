// Reopening a conversation that already exists, from the session's side
// (src/reading/session/use-call.ts). Four doors lead back into one — a mark on
// the page, a mark on a reply, a row of the trace list, the receipt chip — and
// each of them knows a record and a place on screen. What that record is, the
// record says.
//
// This is where it went wrong: the trace list handed in the thread id it had
// found and the mark id the reader had pressed, and the shell believed both. A
// row for a mark drawn on a reply falls back to the classroom it was drawn in,
// which is the book's own conversation, and it came back as an ordinary one —
// the AI pen dead in it, its opening line about a passage, and a stray sentence
// out of one of its replies sitting in the prompt's anchor slot.
//
// Same setup as use-call-aside.test.tsx: the hook needs a document, and the
// application modules are imported statically because a module first evaluated
// with a window in scope keeps whatever it decided about being in a browser
// (pitfall 121).
import { afterEach, expect, spyOn, test } from "bun:test";
import { useCall } from "../../../src/reading/session/use-call";
import { DEFAULT_SETTINGS, type Settings } from "../../../src/platform/app/settings";
import * as agent from "../../../src/ai/agent";
import * as events from "../../../src/platform/app/events";
import * as observation from "../../../src/memory";
import * as threads from "../../../src/platform/app/threads";
import * as turn from "../../../src/reading/turn";
import type { CallRow } from "../../../src/reading/call-state";
import type { StagedImage } from "../../../src/reading/pending-images";
import type { Annotation } from "../../../src/platform/app/reader-contract";
import type { Thread, ThreadMessage } from "../../../src/platform/app/threads";
import { useDom } from "../../support/dom";

const { act, cleanup, renderHook } = await useDom();
afterEach(cleanup);

const BOOK = "book-1";
const LESSON = "lesson-1";
const CHAT_MARK = "chat-mark-1";
const PAGE_MARK = "page-mark-1";

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultProviderId: "anthropic",
  defaultModelId: "some-model",
};

function fakeWorld() {
  const spies = [
    spyOn(events, "logEvent").mockImplementation(() => {}),
    spyOn(observation, "distillThread").mockImplementation(async () => {}),
    spyOn(threads, "getThread").mockImplementation(() => undefined),
    spyOn(turn, "buildReadingTurn").mockResolvedValue({
      systemPrompt: "",
      inline: "none" as const,
      tools: [],
      messages: [],
      notice: "",
      refusal: "",
    }),
    spyOn(agent, "runAgentTurn").mockImplementation(() => new Promise<void>(() => {})),
  ];
  return { restore: () => spies.forEach((s) => s.mockRestore()) };
}

function thread(id: string, extra: Partial<Thread> = {}): Thread {
  return { id, annotationId: "", path: BOOK, createdAt: 0, messages: [], ...extra };
}

// A mark drawn on one of the lesson's replies: no page, and its words are the
// AI's own.
const chatMark: Annotation = {
  id: CHAT_MARK,
  type: "underline",
  color: "#7c3aed",
  text: "attention heads are three matrices",
  chatAnchor: {
    threadId: LESSON,
    messageTs: 9,
    text: "attention heads are three matrices",
    occurrence: 0,
    pen: "ai",
  },
};

// One drawn on the page, which is what a mark-anchored conversation is about.
const pageMark: Annotation = {
  id: PAGE_MARK,
  type: "highlight",
  color: "#ffd400",
  text: "a transformer reads the whole sequence at once",
  pageIndex: 3,
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
    annsRef: { current: new Map([chatMark, pageMark].map((a) => [a.id, a])) },
    currentFulltextRef: { current: null },
    currentFiguresRef: { current: null },
    bufferRef: { current: null },
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

const AT = { view: "chat-main" as const, anchor: { x: 0, y: 0 } };

type Controller = ReturnType<typeof useCall<CallRow, StagedImage>>;
type View = { result: { current: Controller } };

async function ask(view: View, text: string): Promise<void> {
  await act(async () => {
    view.result.current.send(text);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// The trace row for a chat mark whose own conversation is gone falls back to the
// classroom it was drawn in. That classroom is the book's conversation.
test("the classroom a mark was drawn in reopens as the book's conversation", () => {
  const world = fakeWorld();
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    const lesson = thread(LESSON, { book: true, messages: [{ role: "ai", text: "hi", ts: 9 }] });
    act(() => view.result.current.reopenThread(lesson, AT));

    expect(view.result.current.call?.isBook).toBe(true);
    expect(view.result.current.call?.threadId).toBe(LESSON);
    expect(view.result.current.call?.messages).toHaveLength(1);
  } finally {
    world.restore();
  }
});

// What the flag is for. Without it the AI pen inside the reopened lesson draws
// an underline and opens nothing, and the reader is left pressing a control the
// shell has told them is live.
test("the reopened lesson is still the one a pen stroke can open a side conversation off", () => {
  const world = fakeWorld();
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    act(() => view.result.current.reopenThread(thread(LESSON, { book: true }), AT));
    act(() => view.result.current.openChatAside({ messageTs: 9, text: "attention heads" }));

    expect(view.result.current.call?.threadId).not.toBe(LESSON);
    expect(view.result.current.call?.aside?.parentThreadId).toBe(LESSON);
  } finally {
    world.restore();
  }
});

// The other half of the same press: the mark the reader touched is not what the
// conversation is anchored on. The send path reads the annotation under the
// call's id and puts its words in the prompt's anchor slot.
test("a conversation about the book carries no mark into its next turn", async () => {
  const world = fakeWorld();
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    act(() => view.result.current.reopenThread(thread(LESSON, { book: true }), AT));
    expect(view.result.current.call?.annotationId).toBe("");

    await ask(view, "what is this book about?");
    const built = (turn.buildReadingTurn as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as { annotationId: string; annotation?: Annotation };
    expect(built.annotationId).toBe("");
    expect(built.annotation).toBeUndefined();
  } finally {
    world.restore();
  }
});

// A mark's conversation keeps its own mark, which is the one the record names.
test("a mark's conversation reopens on the mark the record names", async () => {
  const world = fakeWorld();
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    act(() => view.result.current.reopenThread(thread("t-mark", { annotationId: PAGE_MARK }), AT));

    expect(view.result.current.call?.annotationId).toBe(PAGE_MARK);
    expect(view.result.current.call?.isBook).toBeUndefined();
    expect(view.result.current.call?.aside).toBeUndefined();

    await ask(view, "what does this mean?");
    const built = (turn.buildReadingTurn as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as { annotationId: string; annotation?: Annotation };
    expect(built.annotationId).toBe(PAGE_MARK);
    expect(built.annotation?.text).toBe(pageMark.text);
  } finally {
    world.restore();
  }
});

// A side conversation drawn on a reply comes back framed: the line above it says
// what it is about, and Back leads to the lesson it came off.
test("a side conversation reopens with the span it was opened on", () => {
  const world = fakeWorld();
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    const aside = thread("t-aside", {
      annotationId: CHAT_MARK,
      parentThreadId: LESSON,
      asideAnchor: { messageTs: 9, text: "attention heads are three matrices" },
    });
    act(() => view.result.current.reopenThread(aside, AT));

    expect(view.result.current.call?.isBook).toBeUndefined();
    expect(view.result.current.call?.annotationId).toBe(CHAT_MARK);
    expect(view.result.current.call?.aside).toEqual({
      parentThreadId: LESSON,
      from: "chat",
      span: "attention heads are three matrices",
    });
  } finally {
    world.restore();
  }
});

// One drawn on the page while the lesson ran has no anchor on its record: its
// span is the marked passage, which lives on the mark.
test("an aside drawn on the page takes its span off its mark", () => {
  const world = fakeWorld();
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    const aside = thread("t-drawn", { annotationId: PAGE_MARK, parentThreadId: LESSON });
    act(() => view.result.current.reopenThread(aside, { ...AT, parentView: "chat-pip" }));

    expect(view.result.current.call?.aside).toEqual({
      parentThreadId: LESSON,
      from: "mark",
      span: pageMark.text as string,
      parentView: "chat-pip",
    });
  } finally {
    world.restore();
  }
});
