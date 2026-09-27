// The registry of turns still streaming (src/reading/live-turns), which is what
// lets a closed bubble keep its reply. Pure. Run: bun test.

import { expect, test } from "bun:test";
import {
  createLiveTurns,
  readingTurns,
  resetReadingTurns,
  type LiveTurn,
} from "../../../src/reading/turn/live-turns";

interface Msg {
  ts: number;
  role: "user" | "ai";
  text: string;
}

function start(turns: ReturnType<typeof createLiveTurns<Msg>>, threadId: string, ts = 1) {
  const controller = new AbortController();
  turns.start({ threadId, bookId: "book", home: "book", controller, message: { ts, role: "ai", text: "" } });
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
  expect(turns.withLive("a", [{ ts: 5, role: "user", text: "asked" }])).toEqual([
    { ts: 5, role: "user", text: "asked" },
    { ts: 7, role: "ai", text: "half a sentence" },
  ]);
});

// The send path used to stamp the question and the reply in the same
// millisecond, and files written then still hold such pairs. Reopening one
// mid-answer must not take the question for the reply.
test("a question sharing the live row's stamp does not stand in for it", () => {
  const turns = createLiveTurns<Msg>();
  start(turns, "a", 7);
  turns.patch("a", 7, (m) => ({ ...m, text: "half" }));
  expect(turns.withLive("a", [{ ts: 7, role: "user", text: "asked" }])).toEqual([
    { ts: 7, role: "user", text: "asked" },
    { ts: 7, role: "ai", text: "half" },
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
  const msgs: Msg[] = [{ ts: 5, role: "user", text: "asked" }];
  expect(turns.withLive("a", msgs)).toBe(msgs);
});

test("the live row is not spliced in twice once it is in the file", () => {
  const turns = createLiveTurns<Msg>();
  start(turns, "a", 7);
  const landed: Msg[] = [
    { ts: 7, role: "user", text: "asked" },
    { ts: 7, role: "ai", text: "landed" },
  ];
  expect(turns.withLive("a", landed)).toEqual(landed);
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

// The registry is a module, not a hook's ref: a turn outlives the reading
// session that started it (docs/68).
test("every session reaches the same registry", () => {
  resetReadingTurns();
  const controller = new AbortController();
  readingTurns<Msg>().start({
    threadId: "a",
    bookId: "book",
    home: "book",
    controller,
    message: { ts: 1, role: "ai", text: "" },
  });
  expect(readingTurns<Msg>().has("a")).toBe(true);
  resetReadingTurns();
  expect(readingTurns<Msg>().has("a")).toBe(false);
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
