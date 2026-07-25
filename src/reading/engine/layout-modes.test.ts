import { expect, test } from "bun:test";
import {
  applyLayout,
  LAYOUT_SETTINGS,
  otherLayout,
  restingState,
  type LayoutEngineState,
  type ReadingLayout,
} from "./layout-modes";

const layouts: ReadingLayout[] = ["vertical", "paged"];

test("the two layouts disagree on every setting they own", () => {
  // If a field were equal in both, leaving a layout would silently keep the
  // other one's value — the shape the stuck-in-a-page-strip bug takes.
  const v = LAYOUT_SETTINGS.vertical;
  const p = LAYOUT_SETTINGS.paged;
  const shared = (Object.keys(v) as (keyof typeof v)[]).filter((k) => v[k] === (p[k] as never));
  expect(shared).toEqual([]);
});

test("a round trip lands exactly where it started", () => {
  for (const start of layouts) {
    const initial = restingState(start, 1.25);
    const there = applyLayout(initial, otherLayout(start));
    const back = applyLayout(there, start);
    expect(back).toEqual(restingState(start, 0));
  }
});

test("switching back and forth repeatedly is stable", () => {
  let s = restingState("vertical");
  const seen: LayoutEngineState[] = [];
  for (let i = 0; i < 6; i++) {
    s = applyLayout(s, i % 2 === 0 ? "paged" : "vertical");
    seen.push(s);
  }
  expect(seen[0]).toEqual(seen[2]);
  expect(seen[2]).toEqual(seen[4]);
  expect(seen[1]).toEqual(seen[3]);
  expect(seen[3]).toEqual(seen[5]);
});

test("applying the same layout twice changes nothing the second time", () => {
  for (const l of layouts) {
    const once = applyLayout(restingState(otherLayout(l)), l);
    expect(applyLayout(once, l)).toEqual(once);
  }
});

test("a switch out of a dirty layout still lands clean", () => {
  // Mid-drag, engine paused, pointer captured, inertia in flight: the switch
  // owns all of it, whichever direction it goes.
  const dirty: LayoutEngineState = {
    ...restingState("paged", 0.97),
    gesturesIdle: false,
    enginePaused: true,
    pointerCaptured: true,
    inertia: true,
  };
  expect(applyLayout(dirty, "vertical")).toEqual(restingState("vertical"));
  expect(applyLayout(dirty, "paged")).toEqual(restingState("paged", 0.97));
});

test("the fit-page baseline is dropped on the way out and never leaks back in", () => {
  const paged = restingState("paged", 1.4);
  const vertical = applyLayout(paged, "vertical");
  expect(vertical.fitPageBaseline).toBe(0);
  // Re-entering paged starts with no baseline: the host recomputes it from the
  // zoom the new fit-page lands on, which a viewport resize may have changed.
  expect(applyLayout(vertical, "paged").fitPageBaseline).toBe(0);
});

test("paged is the horizontal fit-page strip, vertical the fit-width column", () => {
  expect(LAYOUT_SETTINGS.paged.axis).toBe("horizontal");
  expect(LAYOUT_SETTINGS.paged.zoom).toBe("fit-page");
  expect(LAYOUT_SETTINGS.vertical.axis).toBe("vertical");
  expect(LAYOUT_SETTINGS.vertical.zoom).toBe("fit-width");
});

test("otherLayout is the toggle the reader's menu item performs", () => {
  expect(otherLayout("paged")).toBe("vertical");
  expect(otherLayout("vertical")).toBe("paged");
});
