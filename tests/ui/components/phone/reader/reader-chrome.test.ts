// The phone reader's chrome without React (docs/82): where the handles and the
// popups go, what the Marks tab lists, and the hint said once. Run: bun test.

import { expect, test } from "bun:test";
import type { Annotation } from "../../../../../src/platform/app/reader-contract";
import {
  READER_HINT_KEY,
  handleSpots,
  markRows,
  popupSpot,
  takeReaderHint,
} from "../../../../../src/ui/components/phone/reader/reader-chrome";
import { leftEmpty } from "../../../../../src/ui/components/phone/lesson/use-book-lesson";

const FRAME = { top: 0, bottom: 800, left: 0, right: 400 };

test("the handles stand on the first line's left edge and the last line's right edge", () => {
  const spots = handleSpots(
    [
      { left: 120, top: 200, width: 200, height: 20 },
      { left: 20, top: 222, width: 90, height: 20 },
    ],
    FRAME,
  );
  expect(spots.start).toEqual({ x: 120, top: 200, height: 20 });
  expect(spots.end).toEqual({ x: 110, top: 222, height: 20 });
});

test("an end whose line is off the screen has no handle", () => {
  const spots = handleSpots(
    [
      { left: 20, top: -40, width: 200, height: 20 },
      { left: 420, top: 100, width: 90, height: 20 },
    ],
    FRAME,
  );
  expect(spots).toEqual({ start: null, end: null });
});

test("the popup goes above the words, below them when there is no room, centred and kept inside", () => {
  const size = { width: 160, height: 44 };
  expect(popupSpot([{ left: 100, top: 300, width: 100, height: 20 }], FRAME, size, 12)).toEqual({
    left: 70,
    top: 244,
  });
  expect(popupSpot([{ left: 100, top: 30, width: 100, height: 20 }], FRAME, size, 12)).toEqual({
    left: 70,
    top: 62,
  });
  // Near the right edge: held 8px inside it.
  expect(popupSpot([{ left: 360, top: 300, width: 30, height: 20 }], FRAME, size, 12)?.left).toBe(232);
  // Nothing on screen: nowhere to put it.
  expect(popupSpot([{ left: 100, top: 900, width: 100, height: 20 }], FRAME, size, 12)).toBeNull();
});

function mark(id: string, type: string, sortIndex: string, pageIndex: number, extra: Partial<Annotation> = {}): Annotation {
  return {
    id,
    type,
    text: `  words\nof ${id} `,
    sortIndex,
    pageLabel: String(pageIndex + 1),
    position: { type: "FragmentSelector", value: "epubcfi(/6/2!/4,/1:0,/1:3)", pageIndex },
    ...extra,
  } as unknown as Annotation;
}

test("the Marks tab is every page mark in reading order, under its chapter", () => {
  const rows = markRows(
    [
      mark("b", "underline", "00002|0000005", 40, { aiThreadId: "t1" } as Partial<Annotation>),
      mark("a", "highlight", "00001|0000300", 3),
      mark("ink", "ink", "00001|0000001", 3),
      mark("c", "highlight", "00001|0000020", 0),
    ],
    [
      { title: "One", page: 2, level: 0 },
      { title: "Two", page: 40, level: 0 },
    ],
  );
  expect(rows.map((r) => [r.id, r.kind, r.chapter, r.threadId])).toEqual([
    ["c", "highlight", "", null],
    ["a", "highlight", "One", null],
    ["b", "underline", "Two", "t1"],
  ]);
  expect(rows[1].text).toBe("words of a");
});

test("the hint is said once per device, and every time where storage refuses", () => {
  const slots = new Map<string, string>();
  const store = { getItem: (k: string) => slots.get(k) ?? null, setItem: (k: string, v: string) => void slots.set(k, v) };
  expect(takeReaderHint(store)).toBe(true);
  expect(slots.get(READER_HINT_KEY)).toBe("1");
  expect(takeReaderHint(store)).toBe(false);
  expect(takeReaderHint(null)).toBe(true);
});

test("only a passage's conversation with nothing asked is left empty", () => {
  expect(leftEmpty(null)).toBe(false);
  expect(leftEmpty({ isBook: true, annotationId: "", messages: [] })).toBe(false);
  expect(leftEmpty({ annotationId: "m1", messages: [] })).toBe(true);
  expect(leftEmpty({ annotationId: "m1", messages: [{}] })).toBe(false);
});
