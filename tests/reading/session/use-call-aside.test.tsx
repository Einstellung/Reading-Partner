// A side conversation, from the session's side (src/reading/session/use-call.ts):
// that it only opens off the lesson, that opening one costs nothing until the
// reader asks something, that every way out leaves exactly one line on the
// conversation it came off, and that deleting one puts the reader back in that
// conversation rather than out of both.
//
// Same setup as use-call-open.test.tsx: the hook needs a document, and the
// application modules are imported statically because a module first evaluated
// with a window in scope keeps whatever it decided about being in a browser
// (pitfall 121).
import { afterEach, expect, spyOn, test } from "bun:test";
import { useCall } from "../../../src/reading/session/use-call";
import { DEFAULT_SETTINGS, type Settings } from "../../../src/platform/app/settings";
import * as agent from "../../../src/ai/agent";
import * as events from "../../../src/platform/app/events";
import * as observation from "../../../src/observation";
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

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultProviderId: "anthropic",
  defaultModelId: "some-model",
};

// The book's threads file, as the store holds it, plus the two ends of a turn
// held open so a send is only ever a send.
//
// The store double is faithful in the two ways anything here can tell apart: a
// read hands back the record the store is holding rather than a copy of it, and
// an append pushes into that record's own array (platform/app/threads.ts).
// tests/threads-store.test.ts pins both against the real store.
function fakeWorld(seed: Record<string, Thread>) {
  const held = { ...seed };
  const spies = [
    spyOn(threads, "getThread").mockImplementation((bookId, threadId) =>
      bookId === BOOK ? held[threadId] : undefined,
    ),
    spyOn(threads, "appendMessage").mockImplementation((_bookId, threadId, message) => {
      const t = held[threadId];
      if (!t) return undefined;
      t.messages.push(message);
      return t;
    }),
    spyOn(threads, "createAsideThread").mockImplementation((_bookId, threadId, init) => {
      const t: Thread = {
        id: threadId,
        annotationId: init.annotationId ?? "",
        parentThreadId: init.parentThreadId,
        ...(init.asideAnchor ? { asideAnchor: init.asideAnchor } : {}),
        path: BOOK,
        createdAt: 0,
        messages: [],
      };
      held[threadId] = t;
      return t;
    }),
    spyOn(threads, "deleteThreadTree").mockImplementation((_bookId, threadId) => {
      if (!held[threadId]) return [];
      const gone = [
        threadId,
        ...Object.values(held)
          .filter((t) => t.parentThreadId === threadId)
          .map((t) => t.id),
      ];
      for (const id of gone) delete held[id];
      return gone;
    }),
    spyOn(events, "logEvent").mockImplementation(() => {}),
    spyOn(observation, "distillThread").mockImplementation(async () => {}),
    spyOn(turn, "buildReadingTurn").mockResolvedValue({
      systemPrompt: "",
      inline: "none" as const,
      tools: [],
      messages: [],
      notice: "",
      refusal: "",
    }),
    // Answering forever: what matters here is that a turn is running on the
    // thread, never what it writes.
    spyOn(agent, "runAgentTurn").mockImplementation(() => new Promise<void>(() => {})),
  ];
  return { held, restore: () => spies.forEach((s) => s.mockRestore()) };
}

function thread(id: string, extra: Partial<Thread> = {}): Thread {
  return { id, annotationId: "", path: BOOK, createdAt: 0, messages: [], ...extra };
}

function host(
  marks: Annotation[] = [],
  removed: string[] = [],
): Parameters<typeof useCall<CallRow, StagedImage>>[0] {
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
    annsRef: { current: new Map(marks.map((a) => [a.id, a])) },
    currentFulltextRef: { current: null },
    currentFiguresRef: { current: null },
    bufferRef: { current: null },
    pipelineRef: { current: null },
    pushToast: () => {},
    distillAnnotations: () => [],
    removeMark: (id: string) => void removed.push(id),
    toDisplay: (stored: ThreadMessage[]) => stored as CallRow[],
    newRow: (row: CallRow) => row,
    // The card channel the shell owns (the receipt's chip is a card part, and
    // the render layer's protocol is not this layer's to import).
    cards: {
      id: (prefix: string) => `${prefix}-1`,
      row: (_cardId, _card, ts) => ({ role: "ai" as const, text: "", ts }),
      write: (row: CallRow) => row,
    },
    maxImages: 3,
    imageLimitHint: "",
    loadingImage: (id: string) => ({ id }),
    readyImage: (id: string) => ({ id }),
    sendableImages: () => [],
  };
}

const lessonCall = {
  threadId: LESSON,
  annotationId: "",
  isBook: true,
  view: "chat-main" as const,
  anchor: { x: 0, y: 0 },
};

const SPAN = { messageTs: 9, text: "attention heads" };

type Controller = ReturnType<typeof useCall<CallRow, StagedImage>>;
type View = { result: { current: Controller } };

async function ask(view: View, text: string): Promise<void> {
  await act(async () => {
    view.result.current.send(text);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

test("stepping out of the lesson opens a side conversation in its place", () => {
  const world = fakeWorld({ [LESSON]: thread(LESSON, { book: true }) });
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    act(() => view.result.current.openThread(lessonCall, []));
    act(() => view.result.current.openChatAside(SPAN));

    const call = view.result.current.call;
    expect(call?.threadId).not.toBe(LESSON);
    expect(call?.isBook).toBeUndefined();
    expect(call?.aside).toEqual({
      parentThreadId: LESSON,
      from: "chat",
      span: "attention heads",
      anchor: SPAN,
      parentView: "chat-main",
    });
  } finally {
    world.restore();
  }
});

// A conversation pulled out of a reply has no mark and no place in the trace
// list, so one the reader asked nothing in could never be reached again — and it
// would still be in the book's threads file, enumerated by every later pass over
// it. Three taps of the control used to leave three of them.
test("a side conversation nobody asked anything in is never written down", () => {
  const world = fakeWorld({ [LESSON]: thread(LESSON, { book: true }) });
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    act(() => view.result.current.openThread(lessonCall, []));
    for (let i = 0; i < 3; i++) {
      act(() => view.result.current.openChatAside(SPAN));
      act(() => view.result.current.returnFromAside());
    }
    expect(Object.keys(world.held)).toEqual([LESSON]);
    expect(world.held[LESSON].messages).toEqual([]);
  } finally {
    world.restore();
  }
});

test("the record arrives with the first question, carrying the span it was opened on", async () => {
  const world = fakeWorld({ [LESSON]: thread(LESSON, { book: true }) });
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    act(() => view.result.current.openThread(lessonCall, []));
    act(() => view.result.current.openChatAside(SPAN));
    const aside = view.result.current.call!.threadId;
    expect(world.held[aside]).toBeUndefined();

    await ask(view, "what is a head?");

    const record = world.held[aside];
    expect(record.parentThreadId).toBe(LESSON);
    expect(record.asideAnchor).toEqual(SPAN);
    // Never a mark it does not have, and never the marker the top-bar button
    // finds the lesson by.
    expect(record.annotationId).toBe("");
    expect(record.book).toBeUndefined();
    expect(record.messages.map((m) => m.text)).toEqual(["what is a head?"]);
  } finally {
    world.restore();
  }
});

// One level deep, held from this end as well as by the affordance not being
// drawn: a side conversation never opens another, and a mark's conversation is
// not what this opens from.
test("nothing but the lesson can step out", () => {
  const world = fakeWorld({ [LESSON]: thread(LESSON, { book: true }) });
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    act(() => view.result.current.openThread(lessonCall, []));
    act(() => view.result.current.openChatAside(SPAN));
    const aside = view.result.current.call!.threadId;

    act(() => view.result.current.openChatAside({ messageTs: 1, text: "and this" }));
    expect(view.result.current.call?.threadId).toBe(aside);

    act(() =>
      view.result.current.openThread(
        { threadId: "mark-thread", annotationId: "m1", view: "bubble", anchor: { x: 0, y: 0 } },
        [],
      ),
    );
    act(() => view.result.current.openChatAside(SPAN));
    expect(view.result.current.call?.threadId).toBe("mark-thread");
  } finally {
    world.restore();
  }
});

// The receipt: a chip the reader sees and a sentence the model reads, both taken
// from the aside's own first question rather than from a second model call.
test("going back leaves one line on the lesson and reopens it", async () => {
  const world = fakeWorld({ [LESSON]: thread(LESSON, { book: true }) });
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    act(() => view.result.current.openThread(lessonCall, []));
    act(() => view.result.current.openChatAside(SPAN));
    const aside = view.result.current.call!.threadId;
    await ask(view, "what is a head?");

    act(() => view.result.current.returnFromAside());

    const written = world.held[LESSON].messages;
    expect(written).toHaveLength(1);
    expect(written[0].role).toBe("ai");
    expect(written[0].text).toContain("what is a head?");
    // A card part, so the row short-circuits the prose: the reader gets the chip
    // and the model gets the sentence.
    expect(written[0].parts).toEqual([
      {
        type: "card",
        id: "aside-1",
        card: { kind: "aside", threadId: aside, span: "attention heads", question: "what is a head?" },
      },
    ]);
    // Reopened as the lesson, with the line already in the history the reader
    // lands on.
    expect(view.result.current.call?.threadId).toBe(LESSON);
    expect(view.result.current.call?.isBook).toBe(true);
    expect(view.result.current.call?.aside).toBeUndefined();
    expect(view.result.current.call?.messages).toHaveLength(1);
  } finally {
    world.restore();
  }
});

// The flow this is built around: the lesson shrunk to the corner card so the
// reader can read the page, a mark drawn on it, and back. Chat taking the whole
// window on the way back would make them ask for the page again.
test("going back restores the view the conversation was left in", async () => {
  const world = fakeWorld({
    [LESSON]: thread(LESSON, { book: true }),
    drawn: thread("drawn", { annotationId: "m1", parentThreadId: LESSON }),
  });
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    act(() =>
      view.result.current.openThread(
        {
          threadId: "drawn",
          annotationId: "m1",
          aside: { parentThreadId: LESSON, from: "mark", span: "the softmax", parentView: "chat-pip" },
          view: "bubble",
          anchor: { x: 0, y: 0 },
        },
        [],
      ),
    );
    await ask(view, "why normalise?");
    act(() => view.result.current.returnFromAside());

    expect(view.result.current.call?.threadId).toBe(LESSON);
    expect(view.result.current.call?.view).toBe("chat-pip");
  } finally {
    world.restore();
  }
});

// The ✕ and Escape out of the app, closing the book, opening another: the reader
// is done with the doubt either way, and the lesson has to say what happened.
test("hanging up inside a side conversation leaves the line too", async () => {
  const world = fakeWorld({ [LESSON]: thread(LESSON, { book: true }) });
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    act(() => view.result.current.openThread(lessonCall, []));
    act(() => view.result.current.openChatAside(SPAN));
    await ask(view, "why three matrices?");

    act(() => view.result.current.hangUp());

    expect(view.result.current.call).toBeNull();
    expect(world.held[LESSON].messages.map((m) => m.text)).toEqual([
      expect.stringContaining("why three matrices?"),
    ]);
  } finally {
    world.restore();
  }
});

// Reopened from its chip and stepped back again. The question it summarises is
// the first one either way, so a second line would be the same sentence twice.
test("stepping back a second time does not restate it", async () => {
  const world = fakeWorld({ [LESSON]: thread(LESSON, { book: true }) });
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    act(() => view.result.current.openThread(lessonCall, []));
    act(() => view.result.current.openChatAside(SPAN));
    const aside = view.result.current.call!.threadId;
    await ask(view, "what is a head?");
    act(() => view.result.current.returnFromAside());

    act(() =>
      view.result.current.openThread(
        {
          threadId: aside,
          annotationId: "",
          aside: { parentThreadId: LESSON, from: "chat", span: "attention heads" },
          view: "chat-main",
          anchor: { x: 0, y: 0 },
        },
        world.held[aside].messages,
      ),
    );
    act(() => view.result.current.returnFromAside());

    expect(world.held[LESSON].messages).toHaveLength(1);
  } finally {
    world.restore();
  }
});

// With the lesson live the reader may read, scroll and mark the page without
// ending it (docs/09). Everything else keeps hanging up on a touch, which on a
// tablet is the exit that actually gets used.
test("touching the book leaves the lesson up and still hangs up anything else", () => {
  const world = fakeWorld({ [LESSON]: thread(LESSON, { book: true }) });
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    act(() => view.result.current.openThread({ ...lessonCall, view: "chat-pip" }, []));
    act(() => view.result.current.dismissOnPaneTouch());
    expect(view.result.current.call?.threadId).toBe(LESSON);

    act(() =>
      view.result.current.openThread(
        { threadId: "mark-thread", annotationId: "m1", view: "bubble", anchor: { x: 0, y: 0 } },
        [],
      ),
    );
    act(() => view.result.current.dismissOnPaneTouch());
    expect(view.result.current.call).toBeNull();
  } finally {
    world.restore();
  }
});

// Deleting a conversation deletes the side ones off it (platform/app/threads.ts).
// Their marks go with them: a mark is its conversation's only door, so one left
// pointing at a deleted thread opens nothing.
test("deleting the lesson takes its side conversations, and their marks", () => {
  const drawn = "drawn-aside";
  const world = fakeWorld({
    [LESSON]: thread(LESSON, { book: true }),
    [drawn]: thread(drawn, { annotationId: "m1", parentThreadId: LESSON }),
    other: thread("other", { annotationId: "m2" }),
  });
  const removed: string[] = [];
  try {
    const view = renderHook(() =>
      useCall<CallRow, StagedImage>(
        host(
          [
            { id: "m1", type: "underline", aiThreadId: drawn },
            { id: "m2", type: "underline", aiThreadId: "other" },
          ],
          removed,
        ),
      ),
    );
    act(() => view.result.current.openThread(lessonCall, []));
    act(() => view.result.current.deleteOpenThread());

    expect(Object.keys(world.held)).toEqual(["other"]);
    expect(removed).toEqual(["m1"]);
    expect(view.result.current.call).toBeNull();
  } finally {
    world.restore();
  }
});

// A side conversation is one level down from a live one. Throwing it away is not
// throwing away the conversation it came off, and the reader should not have to
// find their way back into a lesson they never left.
test("deleting the side conversation puts the reader back in the lesson", async () => {
  const world = fakeWorld({ [LESSON]: thread(LESSON, { book: true }) });
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    act(() => view.result.current.openThread(lessonCall, []));
    act(() => view.result.current.openChatAside(SPAN));
    const aside = view.result.current.call!.threadId;
    await ask(view, "what is a head?");

    act(() => view.result.current.deleteOpenThread());

    expect(view.result.current.call?.threadId).toBe(LESSON);
    expect(world.held[aside]).toBeUndefined();
    // Discarded, not reported: a chip pointing at a conversation that has just
    // been deleted is a door to nothing.
    expect(world.held[LESSON].messages).toEqual([]);
  } finally {
    world.restore();
  }
});

// A send with an image attached writes the image files out before the message,
// so for a moment the reader has asked something the file does not hold yet.
// Back pressed in that window used to leave a side conversation whose question
// is real and whose parent says nothing was asked — no chip, and for one pulled
// out of a reply no other door either.
test("a question sent with an image attached is reported even if it has not reached the file", async () => {
  const world = fakeWorld({ [LESSON]: thread(LESSON, { book: true }) });
  let releaseImages: () => void = () => {};
  const saveThreadImages = spyOn(threads, "saveThreadImages").mockImplementation(
    () => new Promise<string[]>((resolve) => (releaseImages = () => resolve(["a.png"]))),
  );
  try {
    const withImage = {
      ...host(),
      sendableImages: () => [{ data: "AAAA", mediaType: "image/png" as const }],
    };
    const view = renderHook(() => useCall<CallRow, StagedImage>(withImage));
    act(() => view.result.current.openThread(lessonCall, []));
    act(() => view.result.current.openChatAside(SPAN));
    const aside = view.result.current.call!.threadId;

    act(() => view.result.current.send("what is a head?"));
    // The record is there — that is what the send did first — and the question
    // is not in it yet.
    expect(world.held[aside].messages).toEqual([]);

    act(() => view.result.current.returnFromAside());
    expect(world.held[LESSON].messages.map((m) => m.text)).toEqual([
      expect.stringContaining("what is a head?"),
    ]);

    await act(async () => {
      releaseImages();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  } finally {
    saveThreadImages.mockRestore();
    world.restore();
  }
});

// One level deep. A record naming a parent that is itself an aside is only
// arrivable by sync from a writer that does not keep the rule, and the two
// answers — where the line goes and where the reader goes — have to agree, or a
// line lands on a conversation nobody is returned to.
test("a parent that is itself an aside gets neither the reader nor the line", async () => {
  const world = fakeWorld({
    [LESSON]: thread(LESSON, { book: true }),
    middle: thread("middle", { parentThreadId: LESSON }),
    deep: thread("deep", { parentThreadId: "middle" }),
  });
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    act(() =>
      view.result.current.openThread(
        {
          threadId: "deep",
          annotationId: "",
          aside: { parentThreadId: "middle", from: "chat", span: "s" },
          view: "chat-main",
          anchor: { x: 0, y: 0 },
        },
        [],
      ),
    );
    await ask(view, "what is a head?");

    act(() => view.result.current.returnFromAside());

    expect(world.held.middle.messages).toEqual([]);
    expect(view.result.current.call).toBeNull();
  } finally {
    world.restore();
  }
});

// The store names no ids when it never held the thread — the book's threads file
// failed to load and the reader was told so (session/open-book.ts) — and a turn
// started before that still has to be stopped.
test("deleting a mark stops its turn even when the store never held the thread", async () => {
  const world = fakeWorld({});
  try {
    const view = renderHook(() =>
      useCall<CallRow, StagedImage>(host([{ id: "m1", type: "underline", aiThreadId: "gone" }])),
    );
    act(() =>
      view.result.current.openThread(
        { threadId: "gone", annotationId: "m1", view: "bubble", anchor: { x: 0, y: 0 } },
        [],
      ),
    );
    await ask(view, "what is this?");
    expect(view.result.current.isAnswering("gone")).toBe(true);

    act(() => view.result.current.dropThread("m1", "gone"));

    expect(view.result.current.isAnswering("gone")).toBe(false);
    expect(view.result.current.call).toBeNull();
  } finally {
    world.restore();
  }
});

// A mark drawn on a reply belongs to the book, not to the conversation it was
// drawn in (docs/09). The AI pen's one carries the side conversation it opened,
// exactly as a mark on a passage does — but deleting that conversation must
// leave the mark in annotations and in the trace list, the same way the
// highlight pen's mark on the same reply is left. What it loses is its door.
function onReply(id: string, aiThreadId?: string): Annotation {
  return {
    id,
    type: "underline",
    ...(aiThreadId ? { aiThreadId } : {}),
    chatAnchor: {
      threadId: LESSON,
      messageTs: 9,
      text: `words ${id}`,
      occurrence: 0,
      pen: aiThreadId ? "ai" : "highlight",
    },
  };
}

const bothPens = (pageAside: string, replyAside: string): Annotation[] => [
  { id: "p1", type: "underline", aiThreadId: pageAside },
  onReply("c1", replyAside),
  onReply("c2"),
];

test("deleting the lesson takes the marks off the page, and leaves the ones on its replies", () => {
  const onPage = "page-aside";
  const onAReply = "reply-aside";
  const world = fakeWorld({
    [LESSON]: thread(LESSON, { book: true }),
    [onPage]: thread(onPage, { annotationId: "p1", parentThreadId: LESSON }),
    [onAReply]: thread(onAReply, { annotationId: "c1", parentThreadId: LESSON }),
  });
  const removed: string[] = [];
  try {
    const view = renderHook(() =>
      useCall<CallRow, StagedImage>(host(bothPens(onPage, onAReply), removed)),
    );
    act(() => view.result.current.openThread(lessonCall, []));
    act(() => view.result.current.deleteOpenThread());

    expect(Object.keys(world.held)).toEqual([]);
    expect(removed).toEqual(["p1"]);
  } finally {
    world.restore();
  }
});

// The other end of the same pairing: a mark deleted from the trace list takes
// its conversation and the asides off it, and each of those takes the page mark
// hosting it. A mark on a reply is not one of those either.
test("deleting a page mark leaves the marks drawn on the replies of the thread it takes", () => {
  const onPage = "page-aside";
  const onAReply = "reply-aside";
  const world = fakeWorld({
    [LESSON]: thread(LESSON, { book: true }),
    [onPage]: thread(onPage, { annotationId: "p1", parentThreadId: LESSON }),
    [onAReply]: thread(onAReply, { annotationId: "c1", parentThreadId: LESSON }),
  });
  const removed: string[] = [];
  try {
    const view = renderHook(() =>
      useCall<CallRow, StagedImage>(host(bothPens(onPage, onAReply), removed)),
    );
    act(() => view.result.current.dropThread("m0", LESSON));

    expect(removed).toEqual(["p1"]);
  } finally {
    world.restore();
  }
});
