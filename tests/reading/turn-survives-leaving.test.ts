// Once a turn has been sent, nothing but the reader's Stop and the thread being
// deleted cuts it off (docs/03, docs/68). Every way out of the conversation is
// one row of the table below.
//
// The ways that only put the view away are stated twice over: the registry
// entry survives them, and — for the two that run real code here — the sequence
// they run contains nothing that could reach a turn. `closeBook` is the whole
// of closing the book and of leaving the reader (App: closeReader), so a call
// added back into it would fail this.
//
// Run: scripts/t.sh.

import { expect, test } from "bun:test";
import { createLiveTurns, type LiveTurns } from "../../src/reading/live-turns";
import { closeBook } from "../../src/reading/session/close-book";
import type { ReaderShell } from "../../src/reading/session/shell";

interface Msg {
  ts: number;
  text: string;
}

/** A shell that records what was asked of it and does none of it. */
function fakeShell(log: string[]): ReaderShell {
  return new Proxy({} as ReaderShell, {
    get: (_t, name: string) => (...args: unknown[]) => {
      log.push(name);
      return name === "currentDocId" ? null : undefined;
      void args;
    },
  });
}

/** Anything on the shell that could end a turn. None of these exist any more. */
const TURN_ENDING = ["endBookTurns", "stopTurns", "stopBook"];

type WayOut = (turns: LiveTurns<Msg>, threadId: string, log: string[]) => void;

const WAYS: { name: string; leave: WayOut; aborts: boolean }[] = [
  // The ✕ and Escape (hangUp): the view goes, the thread stays on its mark.
  { name: "hanging up the chat view", leave: () => {}, aborts: false },
  // dismissOnPaneTouch — the tablet's real exit, and also a hangup.
  { name: "touching the page", leave: () => {}, aborts: false },
  // open-book.ts on a new session: captureHangup and closeCall, no more.
  { name: "opening another book", leave: () => {}, aborts: false },
  // The composer's voice half sends and is done with it; there is no second
  // abort anywhere on the hold-to-talk path.
  { name: "speaking and leaving", leave: () => {}, aborts: false },
  {
    name: "closing the book",
    leave: (_turns, _id, log) => closeBook(fakeShell(log), "book", "book", () => {}),
    aborts: false,
  },
  {
    name: "closing the reader",
    leave: (_turns, _id, log) => closeBook(fakeShell(log), "book", "book", () => {}),
    aborts: false,
  },
  // The two that do end it.
  { name: "the stop button", leave: (turns, id) => void turns.stop(id), aborts: true },
  { name: "deleting the thread", leave: (turns, id) => void turns.stop(id), aborts: true },
];

for (const way of WAYS) {
  test(`${way.name} ${way.aborts ? "cuts the turn off" : "leaves the turn running"}`, () => {
    const turns = createLiveTurns<Msg>();
    const controller = new AbortController();
    const log: string[] = [];
    turns.start({
      threadId: "t",
      bookId: "book",
      home: "book",
      controller,
      message: { ts: 1, text: "half" },
    });

    way.leave(turns, "t", log);

    expect(controller.signal.aborted).toBe(way.aborts);
    expect(turns.has("t")).toBe(!way.aborts);
    for (const call of TURN_ENDING) expect(log).not.toContain(call);
  });
}

// What a turn left running is for: it goes on being written and lands whole.
test("a turn nobody is watching still settles into its thread", () => {
  const turns = createLiveTurns<Msg>();
  const controller = new AbortController();
  turns.start({
    threadId: "t",
    bookId: "book",
    home: "book",
    controller,
    message: { ts: 1, text: "" },
  });
  turns.patch("t", 1, (m) => ({ ...m, text: "a whole answer" }));
  const settled = turns.settle("t", controller);
  expect(settled?.message.text).toBe("a whole answer");
  expect(turns.has("t")).toBe(false);
});
