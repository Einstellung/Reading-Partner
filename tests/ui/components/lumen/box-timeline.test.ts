// The box in Lumen's conversation (src/ui/components/lumen/box-timeline.ts,
// docs/68 2026-10-15): which items are drawn, where among the rows, and that an
// item whose own card is already a row is not drawn twice.
// Run: scripts/t.sh tests/ui/components/lumen/box-timeline.test.ts

import { expect, test } from "bun:test";

import type { BoxItem } from "../../../../src/box/types";
import {
  boxCardId,
  boxCardPayload,
  itemIdOfBoxCard,
  timelineItems,
  withBoxCards,
} from "../../../../src/ui/components/lumen/box-timeline";
import { cardRow } from "../../../../src/ui/components/chat/chatParts";
import type { ThreadMessage } from "../../../../src/ui/components/chat/types";

function item(id: string, over: Partial<BoxItem> = {}): BoxItem {
  return {
    id,
    boxId: `box-${id}`,
    source: "run",
    cover: `cover ${id}`,
    origin: { place: "book", bookId: "b1", threadId: "t1", page: 3 },
    needsDecision: false,
    createdAt: 100,
    state: "in-box",
    stateAt: 100,
    revision: 1,
    ...over,
  };
}

const say = (ts: number, text = `line ${ts}`, over: Partial<ThreadMessage> = {}): ThreadMessage => ({
  role: "user",
  text,
  ts,
  ...over,
});

const ids = (rows: ThreadMessage[]) =>
  rows.map((m) => {
    const card = m.parts?.find((p) => p.type === "card");
    return card && card.type === "card" ? card.id : m.ts;
  });

test("today's conversation draws every open item, oldest first; an earlier day draws none", () => {
  const items = [item("b", { createdAt: 300 }), item("a", { createdAt: 50 })];
  expect(timelineItems(items, [], true).map((one) => one.id)).toEqual(["a", "b"]);
  expect(timelineItems(items, [], false)).toEqual([]);
});

test("an intake whose card is a row is not drawn again, nor what was folded under it", () => {
  const intake = item("i", { kind: "link-intake", body: "intake-1", boxId: "run-1", needsDecision: true });
  const sameDelivery = item("r", { boxId: "run-1" });
  const other = item("o");
  const rows = [cardRow("intake-card", { kind: "link-intake", intakeId: "intake-1" }, 90)];
  expect(timelineItems([intake, sameDelivery, other], rows, true).map((one) => one.id)).toEqual(["o"]);
  // Another day's intake has no card here, and stands as a box card.
  expect(timelineItems([intake, other], [], true).map((one) => one.id)).toEqual(["i", "o"]);
});

test("cards go in at the moment their item arrived, before a row said at the same moment or later", () => {
  const rows = [say(100), say(200), say(300)];
  const items = [item("x", { createdAt: 10 }), item("y", { createdAt: 200 }), item("z", { createdAt: 900 })];
  expect(ids(withBoxCards(rows, items, {}))).toEqual([boxCardId("x"), 100, boxCardId("y"), 200, 300, boxCardId("z")]);
});

test("a card never goes below a reply being written or a queued line", () => {
  const rows = [say(100), { role: "ai" as const, text: "…", ts: 150, streaming: true }, say(160, "more", { queued: true })];
  expect(ids(withBoxCards(rows, [item("late", { createdAt: 999 })], {}))).toEqual([100, boxCardId("late"), 150, 160]);
});

test("no items hands the rows back untouched", () => {
  const rows = [say(1)];
  expect(withBoxCards(rows, [], {})).toBe(rows);
});

test("the card carries the book's name and whether it can be pressed away", () => {
  const book = boxCardPayload(item("a"), { b1: "Gödel, Escher, Bach" });
  expect(book).toMatchObject({ kind: "box-item", bookTitle: "Gödel, Escher, Bach", pinned: false });
  const intake = boxCardPayload(
    item("i", { kind: "link-intake", body: "intake-1", origin: { place: "door", date: "2026-10-14" } }),
    {},
  );
  expect(intake).toMatchObject({ bookTitle: null, pinned: true });
});

test("a box card's id names its item, and no other card's does", () => {
  expect(itemIdOfBoxCard(boxCardId("abc"))).toBe("abc");
  expect(itemIdOfBoxCard("topic-1")).toBeNull();
});
