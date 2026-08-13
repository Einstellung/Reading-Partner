// The insets an anchored overlay hands to Radix as collisionPadding. What has
// to hold: a device that reports nothing still gets the design's own gutter, an
// inset larger than the gutter wins, a resize that changes nothing compares
// equal so an open overlay is not re-rendered for it, and the reading happens
// early enough that the first painted frame already has it.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  insetsFromPadding,
  NO_SAFE_AREA,
  OVERLAY_GUTTER,
  safeCollisionPadding,
  sameInsets,
} from "../../../src/ui/components/common/safe-area";

const padding = (top: string, right: string, bottom: string, left: string) => ({
  paddingTop: top,
  paddingRight: right,
  paddingBottom: bottom,
  paddingLeft: left,
});

test("a resolved padding reads back as four numbers", () => {
  expect(insetsFromPadding(padding("59px", "0px", "34px", "0px"))).toEqual({
    top: 59,
    right: 0,
    bottom: 34,
    left: 0,
  });
});

test("fractional insets survive", () => {
  expect(insetsFromPadding(padding("20.5px", "0px", "0px", "0px")).top).toBe(20.5);
});

test("an unmeasured or nonsense padding is no inset", () => {
  expect(insetsFromPadding(padding("", "auto", "-4px", "NaN"))).toEqual(NO_SAFE_AREA);
});

test("no inset still keeps the gutter", () => {
  expect(safeCollisionPadding(NO_SAFE_AREA)).toEqual({
    top: OVERLAY_GUTTER,
    right: OVERLAY_GUTTER,
    bottom: OVERLAY_GUTTER,
    left: OVERLAY_GUTTER,
  });
});

test("an inset larger than the gutter wins, per side", () => {
  // Landscape: the notch is on one side, the home indicator at the bottom.
  expect(safeCollisionPadding({ top: 0, right: 21, bottom: 21, left: 59 })).toEqual({
    top: 8,
    right: 21,
    bottom: 21,
    left: 59,
  });
});

test("the gutter is a floor, not an addition", () => {
  expect(safeCollisionPadding({ top: 4, right: 4, bottom: 4, left: 4 }, 10)).toEqual({
    top: 10,
    right: 10,
    bottom: 10,
    left: 10,
  });
});

test("insets compare by value", () => {
  const a = { top: 59, right: 0, bottom: 34, left: 0 };
  expect(sameInsets(a, { ...a })).toBe(true);
  expect(sameInsets(a, { ...a, left: 1 })).toBe(false);
});

// The measurement's timing. There is no DOM in this runner, so what is checked
// is the source: the hook has to read the insets in a layout effect, because
// every consumer of it places itself in one. A passive effect runs after the
// browser has painted, so the first frame would use the bare gutter and the
// second the real inset — a hop, and only on the devices the insets are for.
const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../src/ui/components");
const overlay = readFileSync(join(SRC, "ui/overlay.tsx"), "utf8");

test("the safe padding is measured before paint", () => {
  // useBeforePaint is useLayoutEffect wherever there is a document to measure.
  expect(overlay).toContain(
    'const useBeforePaint = typeof document === "undefined" ? useEffect : useLayoutEffect;',
  );
  const hook = overlay.slice(
    overlay.indexOf("export function useOverlaySafePadding"),
    overlay.indexOf("export function OverlayLayer"),
  );
  expect(hook).toContain("useBeforePaint(");
  expect(hook).not.toContain("useEffect(");
});

test("everyone who takes the safe padding places itself in a layout effect", () => {
  // The reason the hook cannot wait for the passive phase. A new consumer that
  // places itself some other way makes the rule above worth revisiting.
  for (const file of [
    "reader/AnnotationPopup.tsx",
    "reader/PenToolbar.tsx",
    "chat/CallBubble.tsx",
  ]) {
    const source = readFileSync(join(SRC, file), "utf8");
    expect(source).toContain("useOverlaySafePadding()");
    expect(source).toContain("useLayoutEffect(");
  }
});
