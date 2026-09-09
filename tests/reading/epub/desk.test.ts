import { describe, expect, test } from "bun:test";

import {
  PAGE_GAP,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  anchorAt,
  deskMetrics,
  scrollForAnchor,
  settleFlip,
  type DeskView,
} from "../../../src/reading/epub/page-geometry";

const DESK: DeskView = {
  layout: "vertical",
  scale: 1,
  clientWidth: 800,
  clientHeight: 600,
  scrollLeft: 0,
  scrollTop: 0,
  pagesCount: 20,
};

describe("the desk's slots", () => {
  test("stack down the column with a gap and centre the sheet across the desk", () => {
    const m = deskMetrics("vertical", 1, { clientWidth: 1000, clientHeight: 600 });
    expect(m.slotWidth).toBe(1000);
    expect(m.slotHeight).toBe(PAGE_HEIGHT);
    expect(m.pitchY).toBe(PAGE_HEIGHT + PAGE_GAP);
    expect(m.pitchX).toBe(0);
    expect(m.cardLeft).toBe((1000 - PAGE_WIDTH) / 2);
    expect(m.cardTop).toBe(0);
  });

  test("give the flip one viewport-sized slot per page, sheet centred in it", () => {
    const m = deskMetrics("paged", 0.5, { clientWidth: 800, clientHeight: 600 });
    expect(m.slotWidth).toBe(800);
    expect(m.slotHeight).toBe(600);
    expect(m.pitchX).toBe(800);
    expect(m.pitchY).toBe(0);
    expect(m.cardLeft).toBe((800 - PAGE_WIDTH * 0.5) / 2);
    expect(m.cardTop).toBe((600 - PAGE_HEIGHT * 0.5) / 2);
  });

  test("never make a slot smaller than the sheet in it", () => {
    const m = deskMetrics("vertical", 3, { clientWidth: 800, clientHeight: 600 });
    expect(m.slotWidth).toBe(PAGE_WIDTH * 3);
    expect(m.cardLeft).toBe(0);
  });
});

describe("a zoom anchored on a point", () => {
  const roundTrip = (view: DeskView, vx: number, vy: number, to: number) => {
    const anchor = anchorAt(view, vx, vy);
    const after = { ...view, scale: to };
    const scrolled = scrollForAnchor(after, anchor, vx, vy);
    return anchorAt({ ...after, ...scrolled }, vx, vy);
  };

  test("keeps the same paper under the finger, in the column", () => {
    const view = { ...DESK, scale: 1.25, scrollTop: 1500, scrollLeft: 40 };
    const back = roundTrip(view, 300, 220, 2.5);
    const was = anchorAt(view, 300, 220);
    expect(back.pageIndex).toBe(was.pageIndex);
    expect(back.pageY).toBeCloseTo(was.pageY, 6);
    expect(back.pageX).toBeCloseTo(was.pageX, 6);
  });

  test("keeps the line under the finger in the flip, and stays on the page", () => {
    const view: DeskView = { ...DESK, layout: "paged", scale: 0.6, scrollLeft: 800 * 4 };
    const back = roundTrip(view, 500, 300, 1.4);
    const was = anchorAt(view, 500, 300);
    expect(back.pageIndex).toBe(4);
    expect(back.pageY).toBeCloseTo(was.pageY, 6);
  });

  test("leaves the flip resting on a whole page whatever the scale", () => {
    const view: DeskView = { ...DESK, layout: "paged", scale: 0.6, scrollLeft: 800 * 4 };
    const to = scrollForAnchor({ ...view, scale: 2 }, anchorAt(view, 500, 300), 500, 300);
    const pitch = deskMetrics("paged", 2, { clientWidth: 800, clientHeight: 600 }).pitchX;
    expect(to.scrollLeft).toBe(4 * pitch);
    expect(settleFlip(to.scrollLeft, pitch, 20)).toBeNull();
  });

  test("reads the column's y the same way the scroll writes it", () => {
    // The viewport's top edge is by definition the reading position, so an
    // anchor taken there has to agree with columnPosition's answer.
    const view = { ...DESK, scale: 2, scrollTop: 2 * (PAGE_HEIGHT * 2 + PAGE_GAP) + 300 };
    const at = anchorAt(view, 0, 0);
    expect(at.pageIndex).toBe(2);
    expect(at.pageY).toBeCloseTo(150, 6);
  });

  test("clamps to the pages that exist", () => {
    const view: DeskView = { ...DESK, layout: "paged", scrollLeft: 800 * 99 };
    expect(anchorAt(view, 0, 0).pageIndex).toBe(19);
  });
});

describe("the flip settles on a whole page", () => {
  test("moving to the nearest slot", () => {
    expect(settleFlip(800 * 3 + 200, 800, 20)).toBe(800 * 3);
    expect(settleFlip(800 * 3 + 600, 800, 20)).toBe(800 * 4);
  });

  test("and says so when there is nothing to do", () => {
    expect(settleFlip(800 * 3, 800, 20)).toBeNull();
    expect(settleFlip(800 * 3 + 0.5, 800, 20)).toBeNull();
  });

  test("never past the last page", () => {
    expect(settleFlip(800 * 40, 800, 20)).toBe(800 * 19);
  });

  test("and does nothing with no strip to settle", () => {
    expect(settleFlip(100, 0, 20)).toBeNull();
    expect(settleFlip(100, 800, 0)).toBeNull();
  });
});
