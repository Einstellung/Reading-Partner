// A reading turn that landed with nobody looking at it (src/reading/turn-box).
// Run: scripts/t.sh.

import { expect, test } from "bun:test";
import { createBoxStore } from "../../src/box/store";
import { mapDisk } from "../support/map-disk";
import {
  boxUnseenTurn,
  setOpenCallPeek,
  turnBoxId,
  unseenTurnItem,
  watching,
  watchingNow,
} from "../../src/reading/turn-box";

function memoryBox() {
  return createBoxStore(mapDisk());
}

const ANSWER = {
  threadId: "t-1",
  ts: 1700,
  bookId: "b-hash",
  annotationId: "ann-1",
  page: 42,
  outcome: { kind: "answer" as const, text: "The margin call is the point of it. A longer second sentence." },
};

// The rule the session applies as a turn settles: a card only for a turn
// nobody saw land.
const TURN = { threadId: "t-1", bookId: "b-hash" };

test("a turn landing in the conversation on screen is seen, and boxes nothing", () => {
  expect(watching({ threadId: "t-1" }, "b-hash", TURN)).toBe(true);
});

test("a closed call view, another thread and a closed reader are all unseen", () => {
  expect(watching(null, "b-hash", TURN)).toBe(false);
  expect(watching({ threadId: "t-2" }, "b-hash", TURN)).toBe(false);
  expect(watching({ threadId: "t-1" }, null, TURN)).toBe(false);
  expect(watching({ threadId: "t-1" }, "another-book", TURN)).toBe(false);
});

// The same rule asked from outside React, which is how a delivered run asks it
// (src/reading/deliver.ts hands the bell a `watching` closure over this).
test("what is on screen answers the same rule a settling turn asks", () => {
  const off = setOpenCallPeek(() => ({ open: { threadId: "t-1" }, bookId: "b-hash" }));
  try {
    expect(watchingNow(TURN)).toBe(true);
    expect(watchingNow({ threadId: "t-2", bookId: "b-hash" })).toBe(false);
    expect(watchingNow({ threadId: "t-1", bookId: "another-book" })).toBe(false);
  } finally {
    off();
  }
  const away = setOpenCallPeek(() => ({ open: null, bookId: "b-hash" }));
  try {
    expect(watchingNow(TURN)).toBe(false);
  } finally {
    away();
  }
});

test("no reader mounted is nobody watching", () => {
  expect(watchingNow(TURN)).toBe(false);
});

test("an unseen answer becomes a card pointing back at its thread", () => {
  const item = unseenTurnItem(ANSWER);
  expect(item.boxId).toBe(turnBoxId("t-1", 1700));
  expect(item.source).toBe("turn");
  expect(item.cover).toBe("The margin call is the point of it.");
  expect(item.needsDecision).toBe(false);
  expect(item.origin).toEqual({
    place: "book",
    bookId: "b-hash",
    threadId: "t-1",
    annotationId: "ann-1",
    page: 42,
  });
});

test("a cover is one sentence and never longer than the card", () => {
  const item = unseenTurnItem({ ...ANSWER, outcome: { kind: "answer", text: "x".repeat(400) } });
  expect(item.cover.length).toBeLessThanOrEqual(120);
});

test("a thread with no mark and no page leaves both off the origin", () => {
  const item = unseenTurnItem({ ...ANSWER, annotationId: "", page: null });
  expect(item.origin).toEqual({ place: "book", bookId: "b-hash", threadId: "t-1" });
});

test("a turn that failed unseen is one the reader has to decide about", () => {
  const item = unseenTurnItem({ ...ANSWER, outcome: { kind: "error", message: "Couldn't reach the model" } });
  expect(item.needsDecision).toBe(true);
  expect(item.cover).toBe("Couldn't reach the model");
});

test("the reply is flushed to disk before the card that points at it", async () => {
  const order: string[] = [];
  const box = memoryBox();
  await boxUnseenTurn(ANSWER, {
    box,
    flush: async () => void order.push("flush"),
  });
  order.push("put");
  const items = await box.open();
  expect(order).toEqual(["flush", "put"]);
  expect(items).toHaveLength(1);
  expect(items[0]?.source).toBe("turn");
  expect(items[0]?.createdAt).toBe(1700);
});

test("a card that will not write does not take the turn down with it", async () => {
  await boxUnseenTurn(ANSWER, {
    box: { put: () => Promise.reject(new Error("no disk")) } as never,
    flush: async () => {},
  });
});
