// The status line a reading turn draws before it has written anything
// (src/reading/session/use-call.ts). Extended thinking streams for tens of
// seconds before the first word; the row shows the phase, never the thinking,
// and a view that says nothing new leaves the row the object it was — a row
// rewritten per view would re-render it hundreds of times for one line.
//
// Same setup as use-call-open.test.tsx: the hook needs a document, and the
// application modules are imported statically because a module first evaluated
// with a window in scope keeps whatever it decided about being in a browser
// (pitfall 121).
import { afterEach, expect, spyOn, test } from "bun:test";
import { useCall } from "../../../src/reading/session/use-call";
import { resetReadingTurns } from "../../../src/reading/turn/live-turns";
import * as threads from "../../../src/platform/app/threads";
import * as turn from "../../../src/reading/turn/turn";
import type { CallRow } from "../../../src/reading/turn/call-state";
import type { StagedImage } from "../../../src/reading/turn/pending-images";
import type { Thread, ThreadMessage } from "../../../src/platform/app/threads";
import { useDom } from "../../support/dom";
import { CALL_BOOK as BOOK, callHost as host, emptyReadingTurn, fakeBookTurns } from "../../support/use-call";

const { act, cleanup, renderHook } = await useDom();
afterEach(cleanup);
// The registry of running turns is a module, so a turn a test leaves streaming
// is still on its thread when the next file mounts the hook (docs/pitfall/359).
afterEach(resetReadingTurns);

const THREAD = "t1";
const MARK = "mark-1";

test("a turn that thinks before it writes says so once, whatever the view count", async () => {
  const stored: ThreadMessage[] = [];
  // The turn never settles: what it does on its way to an answer is the point.
  const book = fakeBookTurns();
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
  ];
  try {
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
    expect(book.turns).toHaveLength(1);
    const ts = stored[0]!.ts + 1;
    const streaming = (text: string, phase: "thinking" | "writing"): CallRow => ({
      role: "ai",
      text,
      ts,
      streaming: true,
      phase,
    });

    const aiRow = () => view.result.current.call!.messages.find((m) => m.role === "ai")!;
    act(() => book.last().view([streaming("", "thinking")]));
    expect(aiRow().phase).toBe("thinking");
    // The thinking text itself never reaches the row.
    expect(aiRow().text).toBe("");

    // Every view after the first that says the same leaves the row the object
    // it already was: nothing on screen is rewritten.
    const said = aiRow();
    act(() => {
      for (let i = 0; i < 50; i++) book.last().view([streaming("", "thinking")]);
    });
    expect(aiRow()).toBe(said);

    // The reply arriving is its own evidence, so the line gives way to it.
    act(() => book.last().view([streaming("Because", "writing")]));
    expect(aiRow().phase).toBe("writing");
    expect(aiRow().text).toBe("Because");

    // A second stretch of thinking — after a tool round, say — is a phase change
    // again, so it is drawn.
    act(() => book.last().view([streaming("Because", "thinking")]));
    expect(aiRow().phase).toBe("thinking");
  } finally {
    spies.forEach((s) => s.mockRestore());
    book.restore();
  }
});
