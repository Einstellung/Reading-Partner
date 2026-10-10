// A bell's turn in a book thread the reader is looking at (reading/turn/
// deliver.ts, docs/soul/87), from the session's side: it streams into the
// thread, the stop button and the reader's lines reach it, and how it ends
// decides the bell — stopped with something said is answered and acked,
// stopped with nothing said is a failure and the bell waits for the next pass.
// The bell pass and the delivery are real; the book turn is the stand-in the
// test drives (tests/support/use-call.ts).
//
// Same setup as use-call-open.test.tsx: static imports (pitfall 121).
import { afterEach, expect, spyOn, test } from "bun:test";
import { useCall } from "../../../src/reading/session/use-call";
import { readingTurns, resetReadingTurns } from "../../../src/reading/turn/live-turns";
import { deliverBookBell, type BookBellDeps } from "../../../src/reading/turn/deliver";
import type { ReadingDurable } from "../../../src/reading/turn/durable-runtime";
import * as threads from "../../../src/platform/app/threads";
import * as turn from "../../../src/reading/turn/turn";
import { answerBell, registerTurnDelivery } from "../../../src/soul";
import { createBellStore } from "../../../src/legion/bell";
import { createRunStore } from "../../../src/legion/run/store";
import { createBoxStore } from "../../../src/box";
import type { CallRow } from "../../../src/reading/turn/call-state";
import type { StagedImage } from "../../../src/reading/turn/pending-images";
import type { Thread, ThreadMessage } from "../../../src/platform/app/threads";
import { useDom } from "../../support/dom";
import { mapDisk } from "../../support/map-disk";
import { CALL_BOOK as BOOK, callHost as host, callSettings, emptyReadingTurn, fakeBookTurns } from "../../support/use-call";

const { act, cleanup, renderHook } = await useDom();
afterEach(cleanup);
afterEach(resetReadingTurns);

const THREAD = "t1";
const BELL_ID = "run-done-r-1";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// The durable runtime as the delivery reads it: one conversation, no turn of
// this bell's from before a restart, no other turn landing.
const durable = {
  runtime: {
    conversationFor: async () => ({ id: 1 }),
    storage: { scanTasks: async () => ({ items: [] }) },
  },
  onTurnSettled: () => () => {},
} as unknown as ReadingDurable;

function rig() {
  const stored: ThreadMessage[] = [
    { role: "user", text: "find me the literature", ts: 1000 },
    { role: "ai", text: "Asking for it.", ts: 1001 },
  ];
  const troubles: string[] = [];
  const book = fakeBookTurns();
  const spies = [
    spyOn(threads, "getThread").mockImplementation((bookId, threadId) =>
      bookId === BOOK && threadId === THREAD ? ({ id: THREAD, messages: stored.slice() } as Thread) : undefined,
    ),
    spyOn(threads, "appendMessage").mockImplementation((_bookId, _threadId, message) => void stored.push(message)),
    spyOn(turn, "buildReadingTurn").mockResolvedValue(emptyReadingTurn()),
  ];
  const deps: BookBellDeps = {
    durable: () => Promise.resolve(durable),
    open: async () => ({
      key: BOOK,
      threadId: THREAD,
      turn: { systemPrompt: "", tools: [], messages: [{ role: "user", text: "the bell" }], refusal: "" },
    }),
    turns: readingTurns<CallRow>(),
    threads: {
      messages: () => stored,
      append: (_home, _threadId, message) => void stored.push(message),
      flush: async () => {},
    },
    watching: () => true,
    now: () => 2000,
  };
  const undeliver = registerTurnDelivery("book", (input) => deliverBookBell(input, deps));
  const bells = createBellStore(mapDisk());
  const pass = () =>
    answerBell({
      settings: callSettings,
      bells,
      runs: createRunStore(mapDisk()),
      box: createBoxStore(mapDisk()),
      send: async () => "never sent",
      readFile: () => Promise.reject(new Error("not on this device")),
      now: () => 2000,
      onTrouble: (_bell, reason) => void troubles.push(reason),
    });
  return {
    stored,
    troubles,
    book,
    bells,
    pass,
    restore: () => {
      undeliver();
      spies.forEach((s) => s.mockRestore());
      book.restore();
    },
  };
}
type Rig = ReturnType<typeof rig>;

async function mounted(r: Rig) {
  const view = renderHook(() => useCall<CallRow, StagedImage>(host()));
  act(() => {
    view.result.current.openThread({ threadId: THREAD, annotationId: "", view: "bubble", anchor: { x: 0, y: 0 } }, r.stored.slice());
  });
  await r.bells.ring(
    "run-done",
    {
      runId: "r-1",
      kind: "research-literature",
      brief: "the literature is in",
      deliverTo: JSON.stringify({ place: "book", bookId: BOOK, threadId: THREAD }),
    },
    { at: 1500 },
  );
  return view;
}
type View = Awaited<ReturnType<typeof mounted>>;

/** Start the bell pass and wait until the bell's turn is being driven. */
async function ringing(r: Rig): Promise<{ passing: Promise<number> }> {
  const passing = r.pass();
  for (let i = 0; i < 100 && r.book.turns.length === 0; i++) {
    await act(async () => {
      await tick();
    });
  }
    expect(r.book.turns).toHaveLength(1);
  return { passing };
}

const shape = (view: View) => view.result.current.call!.messages.map((m) => [m.role, m.text, m.queued ?? false]);
const ai = (ts: number, text: string, over: Partial<CallRow> = {}): CallRow => ({ role: "ai", text, ts, ...over });
async function settle(fn: () => void) {
  await act(async () => {
    fn();
    await tick();
  });
}

test("the bell's turn streams into the open thread, and stopped after it spoke it is answered and acked", async () => {
  const r = rig();
  try {
    const view = await mounted(r);
    const { passing } = await ringing(r);
    expect(r.book.last().request.bell).toEqual({ id: BELL_ID, runId: "r-1" });
    expect(view.result.current.isAnswering(THREAD)).toBe(true);

    await settle(() => r.book.last().view([ai(2001, "Four papers came", { streaming: true })]));
    expect(shape(view)).toEqual([
      ["user", "find me the literature", false],
      ["ai", "Asking for it.", false],
      ["ai", "Four papers came", false],
    ]);
    expect(view.result.current.call!.messages[2]!.streaming).toBe(true);

    // The stop button reaches the bell's turn; the turn stays until it settles.
    await settle(() => view.result.current.stop())
    expect(r.book.last().stops).toBe(1);
    expect(view.result.current.isAnswering(THREAD)).toBe(true);

    await settle(() => r.book.last().end({ kind: "stopped", rows: [ai(2001, "Four papers came")], steers: [] }));
    expect(await passing).toBe(1);
    expect((await r.bells.get(BELL_ID))?.state).toBe("acked");
    expect(r.troubles).toEqual([]);
    expect(view.result.current.isAnswering(THREAD)).toBe(false);
    expect(shape(view)).toEqual([
      ["user", "find me the literature", false],
      ["ai", "Asking for it.", false],
      ["ai", "Four papers came", false],
    ]);
  } finally {
    r.restore();
  }
});

test("a line said into the bell's turn steers it rather than starting a turn of its own", async () => {
  const r = rig();
  try {
    const view = await mounted(r);
    const { passing } = await ringing(r);
    await settle(() => r.book.last().view([ai(2001, "Four papers", { streaming: true })]));
    await act(async () => {
      view.result.current.send("which is newest?");
      await tick();
    });

    expect(r.book.turns).toHaveLength(1);
    expect(r.book.last().steered.map((s) => s.text)).toEqual(["which is newest?"]);
    expect(shape(view)).toEqual([
      ["user", "find me the literature", false],
      ["ai", "Asking for it.", false],
      ["ai", "Four papers", false],
      ["user", "which is newest?", true],
    ]);
    // The runtime lands the line with the turn; the session wrote nothing.
    expect(r.stored.map((m) => m.text)).toEqual(["find me the literature", "Asking for it."]);

    const line = r.book.last().steered[0]!;
    await settle(() =>
      r.book.last().end({
        kind: "answered",
        rows: [ai(2001, "Four papers"), { role: "user", text: line.text, ts: line.ts }, ai(line.ts + 1, "The second.")],
      }),
    );
    expect(await passing).toBe(1);
    expect((await r.bells.get(BELL_ID))?.state).toBe("acked");
    expect(shape(view)).toEqual([
      ["user", "find me the literature", false],
      ["ai", "Asking for it.", false],
      ["ai", "Four papers", false],
      ["user", "which is newest?", false],
      ["ai", "The second.", false],
    ]);
  } finally {
    r.restore();
  }
});

test("a bell's turn stopped before it said anything is a failure, and the bell waits for the next pass", async () => {
  const r = rig();
  try {
    const view = await mounted(r);
    const { passing } = await ringing(r);
    await settle(() => view.result.current.stop())
    expect(r.book.last().stops).toBe(1);

        await settle(() => r.book.last().end({ kind: "stopped", rows: [], steers: [] }));
    expect(await passing).toBe(0);
    expect(r.troubles).toEqual(["stopped"]);
    expect((await r.bells.get(BELL_ID))?.state).not.toBe("acked");
    expect((await r.bells.read()).length).toBe(1);
    expect(view.result.current.isAnswering(THREAD)).toBe(false);
    // Nothing was said, so nothing is left on screen for it.
    expect(shape(view)).toEqual([
      ["user", "find me the literature", false],
      ["ai", "Asking for it.", false],
    ]);
  } finally {
    r.restore();
  }
});
