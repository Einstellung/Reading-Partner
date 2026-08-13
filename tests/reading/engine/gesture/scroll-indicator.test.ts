// Headless coverage of the scroll indicator's geometry
// (src/reading/engine/gesture/scroll-indicator.ts). Pure, no DOM — run with `bun test`.
//
// Every expectation below is a literal pixel count for a stated viewport and
// content height, worked out by hand from the two exported constants. Building
// them out of the constants instead would compare the implementation against
// itself: an inset of 4 or of 40 would satisfy `inset + (track - size) * p`
// either way, and the file would go on passing through a change that moved the
// thumb halfway across the screen. So the constants are pinned once, up front,
// and everything after them is arithmetic done here rather than there.

import { test, expect } from "bun:test";
import {
  INDICATOR_MIN_THUMB_PX,
  INDICATOR_TRACK_INSET_PX,
  thumbMetrics,
} from "../../../../src/reading/engine/gesture/scroll-indicator";

// The numbers the rest of the file is computed from. Changing either constant
// is a visible change to the strip, so it has to be a deliberate edit here too.
test("the constants the geometry below is worked out from", () => {
  expect(INDICATOR_TRACK_INSET_PX).toBe(4);
  expect(INDICATOR_MIN_THUMB_PX).toBe(36);
});

test("nothing to scroll, nothing to show", () => {
  expect(thumbMetrics(0, 800, 800)).toBeNull();
  expect(thumbMetrics(0, 800, 600)).toBeNull();
  // Paged mode: the vertical axis never moves.
  expect(thumbMetrics(0, 800, 800.5)).toBeNull();
});

test("a viewport with no height shows nothing rather than dividing by zero", () => {
  expect(thumbMetrics(0, 0, 5000)).toBeNull();
  // 4px of inset at each end eats a viewport 8px tall exactly; one more px of
  // viewport and there is a track to sit on. A wider inset would swallow both.
  expect(thumbMetrics(0, 8, 5000)).toBeNull();
  expect(thumbMetrics(0, 9, 5000)).not.toBeNull();
});

// 800px of viewport, 3200px of document: an 800 - 4 - 4 = 792px track, and a
// quarter of the book on screen, so a 198px thumb resting 4px from the top.
test("the thumb is the visible fraction of the document", () => {
  expect(thumbMetrics(0, 800, 3200)).toEqual({ offset: 4, size: 198 });
});

test("the thumb never shrinks below the floor, however long the book", () => {
  // 792 * 800 / 400000 is under 2px; the floor holds it at 36.
  expect(thumbMetrics(0, 800, 400000)).toEqual({ offset: 4, size: 36 });
});

test("the thumb reaches the end of the track exactly at the end of the document", () => {
  // Scrolled to the bottom: 4 + (792 - 198) = 598, and 598 + 198 = 796, which
  // is 4px short of the 800px viewport — the inset at the other end.
  expect(thumbMetrics(2400, 800, 3200)).toEqual({ offset: 598, size: 198 });
});

test("half way down the document puts the thumb half way down the track", () => {
  // 4 + (792 - 198) / 2 = 301.
  expect(thumbMetrics(1200, 800, 3200)).toEqual({ offset: 301, size: 198 });
});

test("an out-of-range scroll position (mid-bounce) stays on the track", () => {
  // Past the bottom and past the top: both clamp onto the same two ends as the
  // in-range extremes above.
  expect(thumbMetrics(3200, 800, 3200)).toEqual({ offset: 598, size: 198 });
  expect(thumbMetrics(-200, 800, 3200)).toEqual({ offset: 4, size: 198 });
});

// The thumb is capped at the track, not just floored: a document barely longer
// than the screen would otherwise be given a thumb longer than the strip it
// rides in. 800 viewport, 900 content: 792 * 800 / 900 = 704, under the track.
// 802 content: 790.0... under it too — the cap only bites once the floor is the
// larger of the two, which is why it is checked with an explicit floor.
test("a thumb wider than the track is cut down to it", () => {
  // Track 792, floor 5000: the floor wins the max, the track wins the min.
  expect(thumbMetrics(0, 800, 3200, 5000)).toEqual({ offset: 4, size: 792 });
});

// The one relationship test, and it earns its place by using numbers the
// production constants cannot supply: a 10px inset and a 20px floor. A
// `thumbMetrics` that ignored its arguments and read the module constants would
// answer 4 and 36 here.
test("the inset and the floor are arguments, not baked-in constants", () => {
  // Track = 500 - 10 - 10 = 480; 480 * 500 / 2000 = 120, well over the 20px floor.
  expect(thumbMetrics(0, 500, 2000, 20, 10)).toEqual({ offset: 10, size: 120 });
  // Bottom of the same document: 10 + (480 - 120) = 370.
  expect(thumbMetrics(1500, 500, 2000, 20, 10)).toEqual({ offset: 370, size: 120 });
  // And the floor supplied here is the one that holds: 480 * 500 / 500000 is
  // under 1px, so the thumb sits at 20, not at the module's 36.
  expect(thumbMetrics(0, 500, 500000, 20, 10)).toEqual({ offset: 10, size: 20 });
});
