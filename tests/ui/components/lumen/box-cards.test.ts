// The box as the corner and the conversation see it: the line under each
// cover, and what the count decides about the corner (docs/68).
//
// Run: bun test.

import { expect, test } from "bun:test";

import type { BoxItem, BoxOrigin } from "../../../../src/box/types";
import {
  badgeCount,
  bookIdsIn,
  caseLabel,
  showsCase,
  isDismissSwipe,
  originLabel,
  SWIPE_DISMISS_PX,
} from "../../../../src/ui/components/lumen/box-cards";

function item(id: string, over: Partial<BoxItem> = {}): BoxItem {
  return {
    id,
    boxId: "batch-1",
    source: "run",
    cover: `cover ${id}`,
    origin: { place: "door", date: "2026-09-15" },
    needsDecision: false,
    createdAt: 1,
    state: "in-box",
    stateAt: 1,
    revision: 1,
    ...over,
  };
}

test("the case stands there whenever anything is open, and only then", () => {
  expect(showsCase(0)).toBe(false);
  expect(showsCase(1)).toBe(true);
  expect(showsCase(7)).toBe(true);
});

test("the case says how many are waiting", () => {
  expect(caseLabel(0)).toBe("The box");
  expect(caseLabel(1)).toBe("The box, 1 waiting");
  expect(caseLabel(12)).toBe("The box, 12 waiting");
});

test("the badge is nothing at zero", () => {
  expect(badgeCount(0)).toBeNull();
  expect(badgeCount(4)).toBe(4);
});

test("the origin line names the book and the page", () => {
  const origin: BoxOrigin = {
    place: "book",
    bookId: "b1",
    threadId: "t1",
    page: 37,
  };
  expect(originLabel(origin, "Thinking, Fast and Slow")).toBe(
    "Thinking, Fast and Slow · p. 37",
  );
  expect(originLabel({ ...origin, page: undefined }, "A Book")).toBe("A Book");
  // A book that has left the shelf still has items pointing at it.
  expect(originLabel(origin, null)).toBe("A book · p. 37");
});

test("the door and the briefing name themselves and the day", () => {
  expect(originLabel({ place: "door", date: "2026-09-15" }, null)).toBe(
    "At the door · 2026-09-15",
  );
  expect(originLabel({ place: "briefing", date: "2026-09-15" }, null)).toBe(
    "Briefing · 2026-09-15",
  );
});

test("the books the cards have to look up are each asked for once", () => {
  const items = [
    item("a", { origin: { place: "book", bookId: "b1", threadId: "t1" } }),
    item("b", { origin: { place: "book", bookId: "b1", threadId: "t2" } }),
    item("c", { origin: { place: "book", bookId: "b2", threadId: "t3" } }),
    item("d"),
  ];
  expect(bookIdsIn(items)).toEqual(["b1", "b2"]);
});

test("a swipe dismisses only when it is sideways and long enough", () => {
  expect(isDismissSwipe(SWIPE_DISMISS_PX, 4)).toBe(true);
  expect(isDismissSwipe(-SWIPE_DISMISS_PX, 4)).toBe(true);
  expect(isDismissSwipe(SWIPE_DISMISS_PX - 1, 0)).toBe(false);
  // A finger scrolling the conversation travels further down than across.
  expect(isDismissSwipe(80, 120)).toBe(false);
});

test("a coaching or retell card says where it came from", () => {
  expect(originLabel({ place: "talk", outlineId: "o1" }, null)).toBe("Talk coach");
  expect(originLabel({ place: "retell", retellId: "r1" }, null)).toBe("Retell");
});
