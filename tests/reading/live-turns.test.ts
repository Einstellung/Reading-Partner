// The registry of turns still streaming (src/reading/live-turns), which is what
// lets a closed bubble keep its reply. Pure. Run: bun test.

import { expect, test } from "bun:test";
import { createLiveTurns, type LiveTurn } from "../../src/reading/live-turns";

interface Msg {
  ts: number;
  text: string;
}

function start(turns: ReturnType<typeof createLiveTurns<Msg>>, threadId: string, ts = 1) {
  const controller = new AbortController();
  turns.start({ threadId, bookId: "book", controller, message: { ts, text: "" } });
  return controller;
}

test("two threads stream at once: opening the second leaves the first alone", () => {
  const turns = createLiveTurns<Msg>();
  const a = start(turns, "a");
  const b = start(turns, "b");
  expect(a.signal.aborted).toBe(false);
  expect(b.signal.aborted).toBe(false);
  expect(turns.has("a")).toBe(true);
});

test("a second turn on the same thread replaces the first", () => {
  const turns = createLiveTurns<Msg>();
  const first = start(turns, "a", 1);
  const second = start(turns, "a", 2);
  expect(first.signal.aborted).toBe(true);
  expect(second.signal.aborted).toBe(false);
  expect(turns.get("a")?.message.ts).toBe(2);
});

test("the stream is written into the stored row, which reopening splices back in", () => {
  const turns = createLiveTurns<Msg>();
  start(turns, "a", 7);
  turns.patch("a", 7, (m) => ({ ...m, text: `${m.text}half` }));
  turns.patch("a", 7, (m) => ({ ...m, text: `${m.text} a sentence` }));
  expect(turns.withLive("a", [{ ts: 5, text: "asked" }])).toEqual([
    { ts: 5, text: "asked" },
    { ts: 7, text: "half a sentence" },
  ]);
});

test("a patch for another turn's row is ignored", () => {
  const turns = createLiveTurns<Msg>();
  start(turns, "a", 7);
  turns.patch("a", 6, (m) => ({ ...m, text: "stale" }));
  turns.patch("b", 7, (m) => ({ ...m, text: "other thread" }));
  expect(turns.get("a")?.message.text).toBe("");
});

test("a thread with nothing running shows its file history unchanged", () => {
  const turns = createLiveTurns<Msg>();
  const msgs = [{ ts: 5, text: "asked" }];
  expect(turns.withLive("a", msgs)).toBe(msgs);
});

test("the live row is not spliced in twice once it is in the file", () => {
  const turns = createLiveTurns<Msg>();
  start(turns, "a", 7);
  expect(turns.withLive("a", [{ ts: 7, text: "landed" }])).toEqual([{ ts: 7, text: "landed" }]);
});

test("settling ends the turn", () => {
  const turns = createLiveTurns<Msg>();
  const controller = start(turns, "a");
  expect(turns.settle("a", controller)?.threadId).toBe("a");
  expect(turns.has("a")).toBe(false);
});

// The late callback of a superseded turn must not carry off the turn that
// replaced it, or the new answer would stop being tracked halfway through.
test("a superseded turn cannot settle its successor", () => {
  const turns = createLiveTurns<Msg>();
  const first = start(turns, "a", 1);
  start(turns, "a", 2);
  expect(turns.settle("a", first)).toBeUndefined();
  expect(turns.get("a")?.message.ts).toBe(2);
});

test("stopping aborts and hands the turn back so the partial can be kept", () => {
  const turns = createLiveTurns<Msg>();
  const controller = start(turns, "a", 7);
  turns.patch("a", 7, (m) => ({ ...m, text: "half" }));
  const stopped = turns.stop("a") as LiveTurn<Msg>;
  expect(stopped.message.text).toBe("half");
  expect(controller.signal.aborted).toBe(true);
  expect(turns.has("a")).toBe(false);
  expect(turns.stop("a")).toBeUndefined();
});

test("closing a book stops its turns and leaves another book's running", () => {
  const turns = createLiveTurns<Msg>();
  const mine = new AbortController();
  const other = new AbortController();
  turns.start({ threadId: "a", bookId: "book", controller: mine, message: { ts: 1, text: "" } });
  turns.start({ threadId: "b", bookId: "elsewhere", controller: other, message: { ts: 1, text: "" } });
  expect(turns.stopBook("book").map((t) => t.threadId)).toEqual(["a"]);
  expect(mine.signal.aborted).toBe(true);
  expect(other.signal.aborted).toBe(false);
  expect(turns.has("b")).toBe(true);
});

// Hanging up mid-answer defers the observation distillation to the moment the reply
// lands, so it reads a whole answer.
test("work handed to a running turn runs when it settles", () => {
  const turns = createLiveTurns<Msg>();
  const controller = start(turns, "a");
  let ran = 0;
  expect(turns.whenSettled("a", () => ran++)).toBe(true);
  expect(ran).toBe(0);
  turns.settle("a", controller)?.onSettled?.();
  expect(ran).toBe(1);
});

test("a stopped turn still hands its deferred work back", () => {
  const turns = createLiveTurns<Msg>();
  start(turns, "a");
  let ran = 0;
  turns.whenSettled("a", () => ran++);
  turns.stop("a")?.onSettled?.();
  expect(ran).toBe(1);
});

test("with nothing running there is nothing to wait for", () => {
  const turns = createLiveTurns<Msg>();
  expect(turns.whenSettled("a", () => {})).toBe(false);
});
