// The phone lesson's turn on the durable runtime (docs/74, docs/soul/87): the
// reader's line goes into the thread file first, every view of the turn
// replaces the rows after it, and every way a turn ends leaves the right rows
// on screen. The book turn is a stand-in the test drives
// (tests/support/use-call.ts); what the runtime projects and lands is tested
// on its own (tests/reading/turn/durable-*.test.ts).
//
// Static imports, like use-call-steer.test.tsx (pitfall 121).
import { afterEach, expect, spyOn, test } from "bun:test";
import { useLessonCall } from "../../../../../src/ui/components/phone/lesson/use-lesson-call";
import * as threads from "../../../../../src/platform/app/threads";
import * as settings from "../../../../../src/platform/app/settings";
import * as bookThread from "../../../../../src/reading/session/book-thread";
import * as openPdf from "../../../../../src/reading/lesson/open-pdf";
import * as turn from "../../../../../src/reading/turn/turn";
import * as durableRuntime from "../../../../../src/reading/turn/durable-runtime";
import { STALL_MESSAGE } from "../../../../../src/legion/execute/stall";
import type { BookOrigin } from "../../../../../src/reading/turn/durable-book";
import type { CallRow } from "../../../../../src/reading/turn/call-state";
import type { Thread, ThreadMessage } from "../../../../../src/platform/app/threads";
import { useDom } from "../../../../support/dom";
import { emptyReadingTurn, fakeBookTurns, type FakeBookTurn } from "../../../../support/use-call";

const { act, cleanup, renderHook } = await useDom();
afterEach(cleanup);

const BOOK = "/books/lesson.pdf";
const THREAD = "bt-lesson";
const OPENING = "First stop.";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const tail = <T,>(list: readonly T[], back = 1): T | undefined => list[list.length - back];

function rig() {
  const stored: ThreadMessage[] = [{ role: "ai", text: OPENING, ts: 100 }];
  const probes = new Set<(origin: BookOrigin) => boolean>();
  const book = fakeBookTurns();
  let focus: number | null = null;
  let assembled: Promise<unknown> = Promise.resolve(emptyReadingTurn());
  const thread = () => ({ id: THREAD, messages: stored.slice(), focusChapter: focus }) as unknown as Thread;
  const spies = [
    spyOn(settings, "loadSettings").mockResolvedValue({
      ...settings.DEFAULT_SETTINGS,
      defaultProviderId: "anthropic",
      defaultModelId: "model-1",
    } as settings.Settings),
    spyOn(bookThread, "resolveBookThread").mockImplementation(async () => ({ status: "ok", thread: thread() })),
    spyOn(openPdf, "openPhonePdf").mockResolvedValue({ chapters: [], fulltext: { status: "ok" } } as never),
    spyOn(threads, "getThread").mockImplementation((b, t) => (b === BOOK && t === THREAD ? thread() : undefined)),
    spyOn(threads, "getBookThread").mockImplementation(() => thread()),
    spyOn(threads, "appendMessage").mockImplementation((_b, _t, message) => void stored.push(message)),
    spyOn(turn, "buildReadingTurn").mockImplementation(() => assembled as never),
    spyOn(durableRuntime, "setBookWatching").mockImplementation((probe) => {
      probes.add(probe);
      return () => void probes.delete(probe);
    }),
  ];
  return {
    stored,
    book,
    probes,
    setFocus: (n: number) => void (focus = n),
    assemble: (next: Promise<unknown>) => void (assembled = next),
    restore: () => {
      spies.forEach((s) => s.mockRestore());
      book.restore();
    },
  };
}
type Rig = ReturnType<typeof rig>;

async function mounted() {
  const view = renderHook(() => useLessonCall({ bookId: BOOK, title: "Paper", topicId: "t1", topicName: "Topic" }));
  await act(async () => {
    await tick();
    await tick();
  });
  return view;
}
type View = Awaited<ReturnType<typeof mounted>>;

async function ask(view: View, r: Rig, text: string): Promise<{ turn: FakeBookTurn; at: number }> {
  await act(async () => {
    view.result.current.send(text);
    await tick();
  });
  const said = tail(r.stored.filter((m) => m.role === "user"))!;
  return { turn: r.book.last(), at: said.ts };
}

async function settle(turn: FakeBookTurn, end: Parameters<FakeBookTurn["end"]>[0]) {
  await act(async () => {
    turn.end(end);
    await tick();
  });
}

const texts = (view: View) => view.result.current.messages.map((m) => m.text);

test("the question is written first and handed to the runtime; each view replaces the rows after it", async () => {
  const r = rig();
  try {
    const view = await mounted();
    const { turn, at } = await ask(view, r, "What is attention?");
    expect(tail(r.stored)).toMatchObject({ role: "user", text: "What is attention?" });
    expect(turn.request.line).toEqual({ text: "What is attention?", ts: at });
    expect(turn.request.model).toEqual({ provider: "anthropic", modelId: "model-1" });
    expect(turn.request.origin).toMatchObject({ place: "book", bookId: BOOK, threadId: THREAD, home: BOOK });
    // Streaming before the runtime has projected anything.
    expect(view.result.current.streaming).toBe(true);
    expect(tail(view.result.current.messages)).toMatchObject({ role: "ai", text: "", streaming: true });

    const read: CallRow = { role: "ai", text: "Let me look.", ts: at + 1, tools: [{ name: "search", label: "Searching", state: "done" }] };
    act(() => turn.view([read, { role: "ai", text: "Atten", ts: at + 2, streaming: true }]));
    expect(texts(view)).toEqual([OPENING, "What is attention?", "Let me look.", "Atten"]);
    const before = view.result.current.messages;
    act(() => turn.view([read, { role: "ai", text: "Attention is", ts: at + 2, streaming: true }]));
    const after = view.result.current.messages;
    // A streamed token re-renders the row it went into and nothing else.
    expect(after.slice(0, 3)).toEqual(before.slice(0, 3));
    after.slice(0, 3).forEach((row, i) => expect(row).toBe(before[i]!));
    expect(after[3]).not.toBe(before[3]);

    await settle(turn, {
      kind: "answered",
      rows: [read, { role: "ai", text: "Attention is weighing.", ts: at + 2 }],
    });
    expect(view.result.current.streaming).toBe(false);
    expect(texts(view)).toEqual([OPENING, "What is attention?", "Let me look.", "Attention is weighing."]);
    expect(tail(view.result.current.messages)?.streaming).toBeUndefined();
    expect(r.book.turns).toHaveLength(1);
  } finally {
    r.restore();
  }
});

test("what the turn left out rides the answering row", async () => {
  const r = rig();
  r.assemble(Promise.resolve({ ...emptyReadingTurn(), notice: "Left out the appendix." }));
  try {
    const view = await mounted();
    const { turn, at } = await ask(view, r, "Go on.");
    await settle(turn, { kind: "answered", rows: [{ role: "ai", text: "Next.", ts: at + 1 }] });
    expect(tail(view.result.current.messages)).toMatchObject({ text: "Next.", notice: "Left out the appendix." });
  } finally {
    r.restore();
  }
});

test("a line said while the answer is written goes into the turn, queued, not as a second turn", async () => {
  const r = rig();
  try {
    const view = await mounted();
    const { turn, at } = await ask(view, r, "What is attention?");
    act(() => turn.view([{ role: "ai", text: "Atten", ts: at + 1, streaming: true }]));
    await act(async () => {
      view.result.current.send("And heads?");
      await tick();
    });
    expect(turn.steered.map((s) => s.text)).toEqual(["And heads?"]);
    const line = tail(view.result.current.messages)!;
    expect(line).toMatchObject({ role: "user", text: "And heads?", queued: true });
    expect(line.ts).toBe(turn.steered[0]!.ts);
    expect(r.book.turns).toHaveLength(1);
    // The runtime took it: the view carries the line, and it is drawn once.
    act(() =>
      turn.view([
        { role: "ai", text: "Attention.", ts: at + 1 },
        { role: "user", text: "And heads?", ts: line.ts },
        { role: "ai", text: "Heads", ts: line.ts + 1, streaming: true },
      ]),
    );
    expect(texts(view)).toEqual([OPENING, "What is attention?", "Attention.", "And heads?", "Heads"]);
    expect(view.result.current.messages[3]?.queued).toBeUndefined();
    // Taken, so not filed by the screen when the turn ends.
    await settle(turn, {
      kind: "answered",
      rows: [
        { role: "ai", text: "Attention.", ts: at + 1 },
        { role: "user", text: "And heads?", ts: line.ts },
        { role: "ai", text: "Heads are views.", ts: line.ts + 1 },
      ],
    });
    expect(r.stored.filter((m) => m.text === "And heads?")).toHaveLength(0);
    expect(r.book.turns).toHaveLength(1);
  } finally {
    r.restore();
  }
});

test("a line no run took is filed after the answer and opens the next turn", async () => {
  const r = rig();
  try {
    const view = await mounted();
    const { turn, at } = await ask(view, r, "What is attention?");
    turn.taking = false;
    await act(async () => {
      view.result.current.send("And heads?");
      await tick();
    });
    await settle(turn, { kind: "answered", rows: [{ role: "ai", text: "Attention.", ts: at + 1 }] });
    expect(tail(r.stored)).toMatchObject({ role: "user", text: "And heads?" });
    expect(r.book.turns).toHaveLength(2);
    expect(r.book.last().request.line.text).toBe("And heads?");
    expect(texts(view).slice(0, 4)).toEqual([OPENING, "What is attention?", "Attention.", "And heads?"]);
    expect(view.result.current.messages[3]?.queued).toBeUndefined();
  } finally {
    r.restore();
  }
});

const RECEIPT = { label: "Updated your profile", summary: "Prefers short answers" };

test("stop keeps the half sentence and the receipt; a withdrawn line opens the next turn", async () => {
  const r = rig();
  try {
    const view = await mounted();
    const { turn, at } = await ask(view, r, "What is attention?");
    const half: CallRow = {
      role: "ai",
      text: "Attention is",
      ts: at + 1,
      tools: [{ name: "profile_update", label: "Updating your profile", state: "done", receipt: RECEIPT }],
    };
    act(() => turn.view([{ ...half, streaming: true }]));
    act(() => view.result.current.stop());
    expect(turn.stops).toBe(1);
    // Still the turn running until the runtime has settled it.
    expect(view.result.current.streaming).toBe(true);
    await settle(turn, { kind: "stopped", rows: [half], steers: [{ text: "Wait, heads?", ts: at + 5 }] });
    const kept = view.result.current.messages.find((m) => m.ts === at + 1)!;
    expect(kept).toMatchObject({ role: "ai", text: "Attention is" });
    expect(kept.tools?.[0]?.receipt).toEqual(RECEIPT);
    expect(kept.streaming).toBeUndefined();
    expect(tail(r.stored)).toMatchObject({ role: "user", text: "Wait, heads?", ts: at + 5 });
    expect(r.book.turns).toHaveLength(2);
  } finally {
    r.restore();
  }
});

test("a stop before any word leaves no row behind", async () => {
  const r = rig();
  try {
    const view = await mounted();
    const { turn, at } = await ask(view, r, "What is attention?");
    act(() => view.result.current.stop());
    await settle(turn, { kind: "stopped", rows: [{ role: "ai", text: "", ts: at + 1 }], steers: [] });
    expect(texts(view)).toEqual([OPENING, "What is attention?"]);
    expect(view.result.current.streaming).toBe(false);
    expect(r.book.turns).toHaveLength(1);
  } finally {
    r.restore();
  }
});

test("a stop while the turn is being assembled asks nothing", async () => {
  const r = rig();
  let release!: (value: unknown) => void;
  r.assemble(new Promise((resolve) => (release = resolve)));
  try {
    const view = await mounted();
    await act(async () => {
      view.result.current.send("What is attention?");
      await tick();
    });
    expect(tail(view.result.current.messages)?.streaming).toBe(true);
    act(() => view.result.current.stop());
    expect(view.result.current.streaming).toBe(false);
    expect(texts(view)).toEqual([OPENING, "What is attention?"]);
    await act(async () => {
      release(emptyReadingTurn());
      await tick();
    });
    expect(r.book.turns).toHaveLength(0);
  } finally {
    r.restore();
  }
});

test("a refusal and a failure each leave a row of their own, and open nothing", async () => {
  const r = rig();
  try {
    const view = await mounted();
    const first = await ask(view, r, "What is attention?");
    await settle(first.turn, { kind: "refused", rows: [], message: "Too long to send." });
    expect(tail(view.result.current.messages)).toMatchObject({ role: "ai", notice: "Too long to send." });
    expect(view.result.current.streaming).toBe(false);

    const second = await ask(view, r, "Again?");
    act(() => second.turn.view([{ role: "ai", text: "Partly", ts: second.at + 1, streaming: true }]));
    await settle(second.turn, { kind: "failed", rows: [{ role: "ai", text: "Partly", ts: second.at + 1 }], message: "boom" });
    const rows = view.result.current.messages;
    expect(tail(rows, 2)).toMatchObject({ role: "ai", text: "Partly" });
    expect(tail(rows)).toMatchObject({ role: "ai", failed: true, text: "⚠️ Couldn't reach the model. boom" });
    expect(r.book.turns).toHaveLength(2);
  } finally {
    r.restore();
  }
});

test("a stalled turn is asked again once; a second stall is a failure", async () => {
  const r = rig();
  try {
    const view = await mounted();
    const { turn, at } = await ask(view, r, "What is attention?");
    act(() => turn.view([{ role: "ai", text: "Atten", ts: at + 1, streaming: true }]));
    await settle(turn, { kind: "stalled", steers: [] });
    expect(r.book.turns).toHaveLength(2);
    expect(r.book.last().request.line).toEqual({ text: "What is attention?", ts: at });
    // The half-written row went; the asked-again turn's placeholder is there.
    expect(texts(view)).toEqual([OPENING, "What is attention?", ""]);
    await settle(r.book.last(), { kind: "stalled", steers: [] });
    expect(r.book.turns).toHaveLength(2);
    expect(tail(view.result.current.messages)).toMatchObject({
      failed: true,
      text: `⚠️ Couldn't reach the model. ${STALL_MESSAGE}`,
    });
    expect(view.result.current.streaming).toBe(false);
  } finally {
    r.restore();
  }
});

test("read_chapter ticks its chapter as it starts and moves the focus once it has run", async () => {
  const r = rig();
  try {
    const view = await mounted();
    const { turn, at } = await ask(view, r, "Take me to chapter 3.");
    const tool = { name: "read_chapter", label: "Reading chapter 3" };
    act(() => turn.view([{ role: "ai", text: "", ts: at + 1, streaming: true, tools: [{ ...tool, state: "running" }] }]));
    expect([...view.result.current.taught]).toEqual([3]);
    expect(view.result.current.focus).toBeNull();
    r.setFocus(3);
    act(() => turn.view([{ role: "ai", text: "", ts: at + 1, streaming: true, tools: [{ ...tool, state: "done" }] }]));
    expect(view.result.current.focus?.chapter).toBe(3);
  } finally {
    r.restore();
  }
});

test("leaving stops the turn, files what the runtime handed back, and opens nothing", async () => {
  const r = rig();
  try {
    const view = await mounted();
    const { turn, at } = await ask(view, r, "What is attention?");
    // The lesson's turn is watched while it runs: its reply gets no box card.
    expect([...r.probes].some((probe) => probe({ place: "book", bookId: BOOK, threadId: THREAD, home: BOOK }))).toBe(true);
    view.unmount();
    expect(turn.stops).toBe(1);
    // Still watched while the runtime lands what the stop kept.
    expect(r.probes.size).toBe(1);
    await act(async () => {
      turn.end({ kind: "stopped", rows: [{ role: "ai", text: "Half", ts: at + 1 }], steers: [{ text: "And heads?", ts: at + 4 }] });
      await tick();
    });
    expect(tail(r.stored)).toMatchObject({ role: "user", text: "And heads?", ts: at + 4 });
    expect(r.book.turns).toHaveLength(1);
    expect(r.probes.size).toBe(0);
  } finally {
    r.restore();
  }
});

// A turn in flight when the lesson opens — after a restart, the one recovery
// resumed (docs/soul/87, "被杀之后") — is the lesson's turn: drawn, stopped,
// and steered like one it started.
test("a lesson opened with a turn in flight streams it, and Stop reaches it", async () => {
  const r = rig();
  try {
    r.book.inFlight(200);
    const view = await mounted();
    expect(r.book.turns).toHaveLength(1);
    const turn = r.book.last();
    expect(turn.resumed).toEqual({ home: BOOK, threadId: THREAD });
    expect(view.result.current.streaming).toBe(true);
    expect(r.probes.size).toBe(1);
    await act(async () => {
      turn.view([{ role: "ai", text: "Attention is", ts: 201, streaming: true } as CallRow]);
      await tick();
    });
    expect(texts(view)).toEqual([OPENING, "Attention is"]);

    act(() => view.result.current.stop());
    expect(turn.stops).toBe(1);
    await settle(turn, { kind: "stopped", rows: [{ role: "ai", text: "Attention is", ts: 201 }], steers: [] });
    expect(view.result.current.streaming).toBe(false);
    expect(texts(view)).toEqual([OPENING, "Attention is"]);
    expect(r.probes.size).toBe(0);
    expect(r.book.turns).toHaveLength(1);
  } finally {
    r.restore();
  }
});

test("a line said while the turn in flight lands waits for it and then opens the next turn", async () => {
  const r = rig();
  try {
    r.book.inFlight(200);
    const view = await mounted();
    const turn = r.book.last();
    turn.taking = false;
    await act(async () => {
      turn.view([{ role: "ai", text: "Attention weighs tokens.", ts: 201 } as CallRow]);
      view.result.current.send("And heads?");
      await tick();
    });
    expect(turn.steered.map((s) => s.text)).toEqual(["And heads?"]);
    expect(tail(view.result.current.messages)).toMatchObject({ role: "user", text: "And heads?", queued: true });

    await settle(turn, { kind: "answered", rows: [{ role: "ai", text: "Attention weighs tokens.", ts: 201 }] });
    expect(tail(r.stored)).toMatchObject({ role: "user", text: "And heads?" });
    expect(r.book.turns).toHaveLength(2);
    expect(r.book.last().request.line).toEqual({ text: "And heads?", ts: tail(r.stored)!.ts });
    expect(view.result.current.streaming).toBe(true);
  } finally {
    r.restore();
  }
});
