// What the host makes of a deck's messages, and what it puts on the bar
// (src/ui/components/talk/runthrough.ts). The view around it is an iframe and a
// listener; everything that can be wrong is in here. Run: bun test.

import { expect, test } from "bun:test";
import {
  endEvent,
  formatElapsed,
  formatRunDate,
  gotoMessage,
  hasRecordedPages,
  positionLabel,
  readDeckSignal,
  rehearsalReadiness,
  slideEvent,
  utteranceEvent,
  withSlideEvent,
} from "../../../src/ui/components/talk/runthrough";
import type { RunthroughEvent } from "../../../src/reading/runthrough";

const slide = (index: number, total = 12) => ({
  source: "deck",
  type: "slide",
  index,
  total,
  kind: "content",
  title: `Slide ${index}`,
});

test("a ready and a slide message read back as themselves", () => {
  expect(readDeckSignal({ source: "deck", type: "ready", protocol: 1, total: 12 })).toEqual({
    type: "ready",
    protocol: 1,
    total: 12,
  });
  expect(readDeckSignal(slide(3))).toEqual({
    type: "slide",
    index: 3,
    total: 12,
    kind: "content",
    title: "Slide 3",
  });
});

test("anything that is not this deck's contract reads as null", () => {
  expect(readDeckSignal(null)).toBeNull();
  expect(readDeckSignal("slide 3")).toBeNull();
  expect(readDeckSignal({ type: "slide", index: 1, total: 3 })).toBeNull(); // no source
  expect(readDeckSignal({ source: "other", type: "slide", index: 1, total: 3 })).toBeNull();
  expect(readDeckSignal({ source: "deck", type: "hello" })).toBeNull();
  expect(readDeckSignal({ source: "deck", type: "slide", index: "3", total: 12 })).toBeNull();
  expect(readDeckSignal({ source: "deck", type: "ready", total: 12 })).toBeNull();
});

test("a slide message missing its labels still counts as a page", () => {
  expect(readDeckSignal({ source: "deck", type: "slide", index: 0, total: 4 })).toEqual({
    type: "slide",
    index: 0,
    total: 4,
    kind: "",
    title: "",
  });
});

test("the host's goto is addressed to the deck", () => {
  expect(gotoMessage(4)).toEqual({ source: "deck-host", type: "goto", index: 4 });
});

test("a page report becomes a timestamped event", () => {
  const sig = readDeckSignal(slide(2));
  expect(sig?.type).toBe("slide");
  expect(slideEvent(sig as never, 1000)).toEqual({
    kind: "slide",
    at: 1000,
    index: 2,
    slideKind: "content",
    title: "Slide 2",
  });
  expect(utteranceEvent({ text: "so", startedAt: 5, endedAt: 9 })).toEqual({
    kind: "utterance",
    at: 5,
    endedAt: 9,
    text: "so",
  });
  expect(endEvent(7)).toEqual({ kind: "end", at: 7 });
});

test("re-reporting the page that is already up does not open a second visit", () => {
  const one = withSlideEvent([], readDeckSignal(slide(0)) as never, 100);
  const again = withSlideEvent(one, readDeckSignal(slide(0)) as never, 900); // a resize
  expect(again).toHaveLength(1);
  expect(again[0]).toEqual(one[0]);
});

test("coming back to a page later is a second visit", () => {
  let events: RunthroughEvent[] = [];
  events = withSlideEvent(events, readDeckSignal(slide(0)) as never, 100);
  events = withSlideEvent(events, readDeckSignal(slide(1)) as never, 200);
  events = withSlideEvent(events, readDeckSignal(slide(0)) as never, 300);
  expect(events.map((e) => (e.kind === "slide" ? e.index : -1))).toEqual([0, 1, 0]);
});

test("an utterance between two reports of the same page does not split it", () => {
  let events: RunthroughEvent[] = [];
  events = withSlideEvent(events, readDeckSignal(slide(4)) as never, 100);
  events = [...events, utteranceEvent({ text: "and so", startedAt: 150, endedAt: 300 })];
  events = withSlideEvent(events, readDeckSignal(slide(4)) as never, 400);
  expect(events).toHaveLength(2);
});

test("a run with no page ever reported is not a pass through the talk", () => {
  expect(hasRecordedPages([])).toBe(false);
  expect(hasRecordedPages([endEvent(1)])).toBe(false);
  expect(hasRecordedPages([utteranceEvent({ text: "hm", startedAt: 1, endedAt: 2 })])).toBe(false);
  expect(hasRecordedPages(withSlideEvent([], readDeckSignal(slide(0)) as never, 1))).toBe(true);
});

test("elapsed time reads in minutes until it needs hours", () => {
  expect(formatElapsed(0)).toBe("0:00");
  expect(formatElapsed(9_000)).toBe("0:09");
  expect(formatElapsed(61_000)).toBe("1:01");
  expect(formatElapsed(11 * 60_000 + 7_000)).toBe("11:07");
  expect(formatElapsed(3_600_000)).toBe("1:00:00");
  expect(formatElapsed(3_723_000)).toBe("1:02:03");
  expect(formatElapsed(-5)).toBe("0:00");
});

test("a run in this year is dated by time of day, an older one by year", () => {
  const at = new Date(2026, 7, 19, 14, 32).getTime();
  expect(formatRunDate(at, new Date(2026, 11, 1))).toBe("Aug 19, 14:32");
  expect(formatRunDate(at, new Date(2027, 0, 3))).toBe("Aug 19 2026");
});

test("the Rehearse button says why it is off", () => {
  expect(rehearsalReadiness({ deckFile: null, loading: true }).ok).toBe(false);
  expect(rehearsalReadiness({ deckFile: null, loading: true }).title).toContain("Looking");
  const none = rehearsalReadiness({ deckFile: null, loading: false });
  expect(none.ok).toBe(false);
  expect(none.title).toContain("no deck");
  expect(rehearsalReadiness({ deckFile: "slides/t-x.html", loading: false }).ok).toBe(true);
});

test("the counter is 1-based, and says nothing before the deck does", () => {
  expect(positionLabel(null)).toBe("—");
  expect(positionLabel({ index: 0, total: 12 })).toBe("1 / 12");
  expect(positionLabel({ index: 11, total: 12 })).toBe("12 / 12");
});
