// Headless coverage of the scroll indicator's geometry
// (src/reader-embedpdf/scroll-indicator.ts). Pure, no DOM — run with `bun test`.

import { test, expect } from "bun:test";
import {
  INDICATOR_MIN_THUMB_PX,
  INDICATOR_TRACK_INSET_PX,
  thumbMetrics,
} from "../src/reader-embedpdf/scroll-indicator";

const inset = INDICATOR_TRACK_INSET_PX;

test("nothing to scroll, nothing to show", () => {
  expect(thumbMetrics(0, 800, 800)).toBeNull();
  expect(thumbMetrics(0, 800, 600)).toBeNull();
  // Paged mode: the vertical axis never moves.
  expect(thumbMetrics(0, 800, 800.5)).toBeNull();
});

test("a viewport with no height shows nothing rather than dividing by zero", () => {
  expect(thumbMetrics(0, 0, 5000)).toBeNull();
  expect(thumbMetrics(0, 4, 5000)).toBeNull(); // the track is all inset
});

test("the thumb is the visible fraction of the document", () => {
  const m = thumbMetrics(0, 800, 3200)!;
  const track = 800 - inset * 2;
  expect(m.size).toBeCloseTo(track / 4, 6);
  expect(m.offset).toBe(inset);
});

test("the thumb never shrinks below the floor, however long the book", () => {
  const m = thumbMetrics(0, 800, 400000)!;
  expect(m.size).toBe(INDICATOR_MIN_THUMB_PX);
});

test("the thumb reaches the end of the track exactly at the end of the document", () => {
  const client = 800;
  const content = 3200;
  const track = client - inset * 2;
  const m = thumbMetrics(content - client, client, content)!;
  expect(m.offset + m.size).toBeCloseTo(inset + track, 6);
});

test("half way down the document puts the thumb half way down the track", () => {
  const m = thumbMetrics(1200, 800, 3200)!;
  const track = 800 - inset * 2;
  expect(m.offset).toBeCloseTo(inset + (track - m.size) / 2, 6);
});

test("an out-of-range scroll position (mid-bounce) stays on the track", () => {
  const client = 800;
  const content = 3200;
  const track = client - inset * 2;
  const past = thumbMetrics(content, client, content)!;
  expect(past.offset + past.size).toBeCloseTo(inset + track, 6);
  expect(thumbMetrics(-200, client, content)!.offset).toBe(inset);
});
