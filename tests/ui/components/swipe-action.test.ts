// The trace list's swipe-to-reveal machine: axis routing against the list's own
// scrolling, where the row comes to rest, and the two steps a delete costs.

import { expect, test } from "bun:test";
import {
  SWIPE_ACTION_WIDTH,
  SWIPE_SLOP,
  actionVisible,
  classifyDrag,
  clampOffset,
  initSwipeState,
  restingOffset,
  rowClickAction,
  stepSwipe,
  trackedOpen,
  type SwipeCommand,
  type SwipeInput,
  type SwipeState,
} from "../../../src/ui/components/reader/swipe-action";

// Feed a script of inputs, returning the final state and every command emitted.
function run(inputs: SwipeInput[], from: SwipeState = initSwipeState()) {
  let state = from;
  const commands: SwipeCommand[] = [];
  for (const input of inputs) {
    const out = stepSwipe(state, input);
    state = out.state;
    commands.push(...out.commands);
  }
  return { state, commands };
}

const W = SWIPE_ACTION_WIDTH;

// --- axis routing -----------------------------------------------------------

test("a drag under the slop is not classified yet", () => {
  expect(classifyDrag(0, 0)).toBe("undecided");
  expect(classifyDrag(SWIPE_SLOP - 1, SWIPE_SLOP - 1)).toBe("undecided");
  expect(classifyDrag(-(SWIPE_SLOP - 1), 0)).toBe("undecided");
});

test("the dominant axis decides, and a tie goes to the list's scroll", () => {
  expect(classifyDrag(-30, 4)).toBe("horizontal");
  expect(classifyDrag(4, -30)).toBe("vertical");
  expect(classifyDrag(-20, 20)).toBe("vertical");
  expect(classifyDrag(-20, 19)).toBe("horizontal");
});

test("a gesture given to the scroll never comes back as a swipe", () => {
  const { state, commands } = run([
    { type: "pointerdown", id: 1, x: 100, y: 100 },
    { type: "pointermove", id: 1, x: 100, y: 140 }, // vertical: released
    { type: "pointermove", id: 1, x: 0, y: 140 }, // now far to the left
    { type: "pointerup", id: 1 },
  ]);
  expect(state.phase).toBe("closed");
  expect(state.offset).toBe(0);
  expect(commands).toEqual([]);
});

test("a committed swipe never falls through to the scroll", () => {
  const { state, commands } = run([
    { type: "pointerdown", id: 1, x: 100, y: 100 },
    { type: "pointermove", id: 1, x: 80, y: 100 }, // horizontal: committed
    { type: "pointermove", id: 1, x: 76, y: 200 }, // mostly vertical from here
  ]);
  expect(state.phase).toBe("dragging");
  expect(state.offset).toBe(-24);
  expect(commands).toContainEqual({ type: "capture", id: 1 });
  expect(commands.filter((c) => c.type === "preventDefault").length).toBe(2);
});

// --- travel and rest --------------------------------------------------------

test("the row travels between shut and fully open, and no further", () => {
  expect(clampOffset(20)).toBe(0); // a rightward drag on a shut row moves nothing
  expect(clampOffset(-40)).toBe(-40);
  expect(clampOffset(-400)).toBe(-W); // no rubber band past the action
});

test("a release past the halfway mark stays open, short of it snaps shut", () => {
  expect(restingOffset(-W / 2)).toBe(-W);
  expect(restingOffset(-W / 2 + 1)).toBe(0);
  expect(restingOffset(-W)).toBe(-W);
  expect(restingOffset(0)).toBe(0);
});

test("a swipe past the threshold leaves the row open and tells the list", () => {
  const { state, commands } = run([
    { type: "pointerdown", id: 1, x: 200, y: 50 },
    { type: "pointermove", id: 1, x: 140, y: 52 },
    { type: "pointermove", id: 1, x: 120, y: 52 },
    { type: "pointerup", id: 1 },
  ]);
  expect(state.phase).toBe("open");
  expect(state.offset).toBe(-W);
  expect(actionVisible(state)).toBe(true);
  expect(commands).toContainEqual({ type: "releaseCapture", id: 1 });
  expect(commands).toContainEqual({ type: "openChanged", open: true });
});

test("a half-hearted swipe leaves nothing armed behind it", () => {
  const { state, commands } = run([
    { type: "pointerdown", id: 1, x: 200, y: 50 },
    { type: "pointermove", id: 1, x: 180, y: 50 },
    { type: "pointerup", id: 1 },
  ]);
  expect(state.phase).toBe("closed");
  expect(state.offset).toBe(0);
  expect(actionVisible(state)).toBe(false);
  expect(commands).not.toContainEqual({ type: "openChanged", open: true });
});

test("dragging an open row back shut reports it shut", () => {
  const opened = run([{ type: "open" }]).state;
  const { state, commands } = run(
    [
      { type: "pointerdown", id: 2, x: 100, y: 50 },
      { type: "pointermove", id: 2, x: 160, y: 50 },
      { type: "pointerup", id: 2 },
    ],
    opened,
  );
  expect(state.phase).toBe("closed");
  expect(commands).toContainEqual({ type: "openChanged", open: false });
});

test("a drag out of an open row measures from where the row already is", () => {
  const opened = run([{ type: "open" }]).state;
  const { state } = run(
    [
      { type: "pointerdown", id: 2, x: 100, y: 50 },
      { type: "pointermove", id: 2, x: 130, y: 50 },
    ],
    opened,
  );
  expect(state.offset).toBe(-W + 30);
  expect(trackedOpen(state)).toBe(true); // still the list's open row until it settles
});

test("a cancelled gesture puts the row back where it started", () => {
  const { state, commands } = run([
    { type: "pointerdown", id: 1, x: 200, y: 50 },
    { type: "pointermove", id: 1, x: 110, y: 50 },
    { type: "pointercancel", id: 1 },
  ]);
  expect(state.offset).toBe(0);
  expect(state.phase).toBe("closed");
  expect(commands).toContainEqual({ type: "releaseCapture", id: 1 });
  expect(commands).not.toContainEqual({ type: "openChanged", open: true });
});

test("a tap leaves the row exactly as it found it", () => {
  const closed = run([
    { type: "pointerdown", id: 1, x: 100, y: 50 },
    { type: "pointerup", id: 1 },
  ]);
  expect(closed.state.phase).toBe("closed");
  expect(closed.commands).toEqual([]);

  const opened = run([{ type: "open" }]).state;
  const still = run(
    [
      { type: "pointerdown", id: 2, x: 100, y: 50 },
      { type: "pointerup", id: 2 },
    ],
    opened,
  );
  expect(still.state.phase).toBe("open");
  expect(still.commands).toEqual([]);
});

test("a second pointer landing mid-gesture is not a second swipe", () => {
  const { state } = run([
    { type: "pointerdown", id: 1, x: 200, y: 50 },
    { type: "pointermove", id: 1, x: 160, y: 50 },
    { type: "pointerdown", id: 2, x: 200, y: 50 },
    { type: "pointermove", id: 2, x: 200, y: 50 },
    { type: "pointerup", id: 2 },
  ]);
  expect(state.phase).toBe("dragging");
  expect(state.pointerId).toBe(1);
  expect(state.offset).toBe(-40);
});

// --- the two steps a delete costs -------------------------------------------

test("the swipe itself never deletes: it only uncovers the action", () => {
  const { commands } = run([
    { type: "pointerdown", id: 1, x: 200, y: 50 },
    { type: "pointermove", id: 1, x: 100, y: 50 },
    { type: "pointerup", id: 1 },
  ]);
  // Nothing but capture bookkeeping and the open report — no verdict of its own.
  expect(commands.map((c) => c.type).filter((t) => t !== "preventDefault")).toEqual([
    "capture",
    "suppressClick",
    "releaseCapture",
    "openChanged",
  ]);
});

test("the click that ends a drag is not a tap on the row", () => {
  expect(rowClickAction(false, true)).toBe("ignore");
  expect(rowClickAction(true, true)).toBe("ignore");
});

test("a click on a shut row selects; on an open row it shuts it instead", () => {
  expect(rowClickAction(false, false)).toBe("select");
  expect(rowClickAction(true, false)).toBe("close");
});

test("a pointer device opens the row without dragging it", () => {
  const { state, commands } = run([{ type: "open" }]);
  expect(state.phase).toBe("open");
  expect(state.offset).toBe(-W);
  expect(commands).toEqual([{ type: "openChanged", open: true }]);
});

test("the list can shut a row from outside, mid-drag if it has to", () => {
  const { state, commands } = run([
    { type: "pointerdown", id: 1, x: 200, y: 50 },
    { type: "pointermove", id: 1, x: 100, y: 50 },
    { type: "close" },
  ]);
  expect(state.phase).toBe("closed");
  expect(state.offset).toBe(0);
  expect(state.pointerId).toBe(null);
  expect(commands).toContainEqual({ type: "releaseCapture", id: 1 });
});
