// A side conversation, from the session's side (src/reading/session/use-call.ts):
// that it only opens off the lesson, that it replaces it in the one call slot,
// that every way out of it leaves exactly one line on the lesson, and that
// deleting a conversation takes the asides off it with their marks.
//
// Same setup as use-call-open.test.tsx: the hook needs a document, and the
// application modules are imported statically because a module first evaluated
// with a window in scope keeps whatever it decided about being in a browser
// (pitfall 121).
import { afterEach, expect, spyOn, test } from "bun:test";
import { useCall } from "../../../src/reading/session/use-call";
import { DEFAULT_SETTINGS, type Settings } from "../../../src/platform/app/settings";
import * as events from "../../../src/platform/app/events";
import * as observation from "../../../src/observation";
import * as threads from "../../../src/platform/app/threads";
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

// The book's threads file, as the store holds it. Every read hands back a copy
// of the record, the way the real store hands back what it parsed.
function fakeStore(seed: Record<string, Thread>) {
  const held = { ...seed };
  const spies = [
    spyOn(threads, "getThread").mockImplementation((bookId, threadId) =>
      bookId === BOOK && held[threadId] ? ({ ...held[threadId] } as Thread) : undefined,
    ),
    spyOn(threads, "appendMessage").mockImplementation((_bookId, threadId, message) => {
      const t = held[threadId];
      if (!t) return undefined;
      t.messages = [...t.messages, message];
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

test("stepping out of the lesson opens a side conversation in its place", () => {
  const store = fakeStore({ [LESSON]: thread(LESSON, { book: true }) });
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
    });
    // A record of its own from the moment it opens, so hanging up in it does not
    // lose it. Never `book`, and never a mark it does not have.
    const record = store.held[call!.threadId];
    expect(record.parentThreadId).toBe(LESSON);
    expect(record.asideAnchor).toEqual(SPAN);
    expect(record.annotationId).toBe("");
    expect(record.book).toBeUndefined();
  } finally {
    store.restore();
  }
});

// One level deep, held from this end as well as by the affordance not being
// drawn: a side conversation never opens another, and a mark's conversation is
// not what this opens from.
test("nothing but the lesson can step out", () => {
  const store = fakeStore({ [LESSON]: thread(LESSON, { book: true }) });
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
    store.restore();
  }
});

// The receipt: a chip the reader sees and a sentence the model reads, both taken
// from the aside's own first question rather than from a second model call.
test("going back leaves one line on the lesson and reopens it", () => {
  const store = fakeStore({ [LESSON]: thread(LESSON, { book: true }) });
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    act(() => view.result.current.openThread(lessonCall, []));
    act(() => view.result.current.openChatAside(SPAN));
    const aside = view.result.current.call!.threadId;
    store.held[aside].messages = [{ role: "user", text: "what is a head?", ts: 10 }];

    act(() => view.result.current.returnFromAside());

    const written = store.held[LESSON].messages;
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
    store.restore();
  }
});

// The ✕ and Escape out of the app, closing the book, opening another: the reader
// is done with the doubt either way, and the lesson has to say what happened.
test("hanging up inside a side conversation leaves the line too", () => {
  const store = fakeStore({ [LESSON]: thread(LESSON, { book: true }) });
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    act(() => view.result.current.openThread(lessonCall, []));
    act(() => view.result.current.openChatAside(SPAN));
    const aside = view.result.current.call!.threadId;
    store.held[aside].messages = [{ role: "user", text: "why three matrices?", ts: 10 }];

    act(() => view.result.current.hangUp());

    expect(view.result.current.call).toBeNull();
    expect(store.held[LESSON].messages.map((m) => m.text)).toEqual([
      expect.stringContaining("why three matrices?"),
    ]);
  } finally {
    store.restore();
  }
});

test("a side conversation nobody asked anything in leaves nothing", () => {
  const store = fakeStore({ [LESSON]: thread(LESSON, { book: true }) });
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    act(() => view.result.current.openThread(lessonCall, []));
    act(() => view.result.current.openChatAside(SPAN));
    act(() => view.result.current.returnFromAside());
    expect(store.held[LESSON].messages).toEqual([]);
  } finally {
    store.restore();
  }
});

// Reopened from its chip and stepped back again. The question it summarises is
// the first one either way, so a second line would be the same sentence twice.
test("stepping back a second time does not restate it", () => {
  const store = fakeStore({ [LESSON]: thread(LESSON, { book: true }) });
  try {
    const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
    act(() => view.result.current.openThread(lessonCall, []));
    act(() => view.result.current.openChatAside(SPAN));
    const aside = view.result.current.call!.threadId;
    store.held[aside].messages = [{ role: "user", text: "what is a head?", ts: 10 }];
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
        store.held[aside].messages,
      ),
    );
    act(() => view.result.current.returnFromAside());

    expect(store.held[LESSON].messages).toHaveLength(1);
  } finally {
    store.restore();
  }
});

// With the lesson live the reader may read, scroll and mark the page without
// ending it (docs/09). Everything else keeps hanging up on a touch, which on a
// tablet is the exit that actually gets used.
test("touching the book leaves the lesson up and still hangs up anything else", () => {
  const store = fakeStore({ [LESSON]: thread(LESSON, { book: true }) });
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
    store.restore();
  }
});

// Deleting a conversation deletes the side ones off it (platform/app/threads.ts).
// Their marks go with them: a mark is its conversation's only door, so one left
// pointing at a deleted thread opens nothing.
test("deleting the lesson takes its side conversations, and their marks", () => {
  const drawn = "drawn-aside";
  const store = fakeStore({
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

    expect(Object.keys(store.held)).toEqual(["other"]);
    expect(removed).toEqual(["m1"]);
    expect(view.result.current.call).toBeNull();
  } finally {
    store.restore();
  }
});
