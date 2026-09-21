// What a finger on the reflow column means, without a column under it.

import { describe, expect, test } from "bun:test";
import {
  IDLE,
  LONG_PRESS_MS,
  PRESS_SLOP_PX,
  claimsTouch,
  intrinsicHeightEstimate,
  pressStep,
  wordBoundsAt,
  type PressEvent,
  type PressState,
} from "../../../src/reading/epub/flow-gesture";
import { FLOW_DISPLAY_DEFAULT } from "../../../src/reading/epub/flow-display";

const down = (over: Partial<Extract<PressEvent, { kind: "down" }>> = {}): PressEvent => ({
  kind: "down",
  pointerId: 1,
  x: 100,
  y: 200,
  t: 1000,
  onWords: true,
  tool: "none",
  primary: true,
  ...over,
});
const move = (x: number, y: number, t = 1100, pointerId = 1): PressEvent => ({ kind: "move", pointerId, x, y, t });
const up = (x = 100, y = 200, t = 1200, pointerId = 1): PressEvent => ({ kind: "up", pointerId, x, y, t });
const hold = (t: number, pointerId = 1): PressEvent => ({ kind: "hold", pointerId, t });
const cancel = (pointerId = 1): PressEvent => ({ kind: "cancel", pointerId });

function run(events: PressEvent[], from: PressState = IDLE) {
  let state = from;
  const effects: string[] = [];
  for (const e of events) {
    const next = pressStep(state, e);
    state = next.state;
    effects.push(next.effect);
  }
  return { state, effects };
}

describe("a press with no pen in hand", () => {
  test("a press on the words arms the long-press timer", () => {
    const { state, effects } = run([down()]);
    expect(effects).toEqual(["arm"]);
    expect(state.phase).toBe("pressed");
  });

  test("a press off the words is not armed, and lifting it is still a tap", () => {
    const { state, effects } = run([down({ onWords: false }), up()]);
    expect(effects).toEqual(["none", "tap"]);
    expect(state).toEqual(IDLE);
  });

  test("a second finger is never a press", () => {
    expect(run([down({ primary: false })]).effects).toEqual(["none"]);
  });

  test("lifting before the hold is a tap", () => {
    const { state, effects } = run([down(), move(103, 202), up(103, 202)]);
    expect(effects).toEqual(["arm", "none", "tap"]);
    expect(state).toEqual(IDLE);
  });

  test("held still past the delay, the press starts a mark", () => {
    const { state, effects } = run([down(), hold(1000 + LONG_PRESS_MS)]);
    expect(effects).toEqual(["arm", "start-mark"]);
    expect(state.phase).toBe("marking");
  });

  test("a timer that fires early does nothing", () => {
    const { state, effects } = run([down(), hold(1000 + LONG_PRESS_MS - 1)]);
    expect(effects).toEqual(["arm", "none"]);
    expect(state.phase).toBe("pressed");
  });

  test("a drift inside the slop is still a press", () => {
    const { state } = run([down(), move(100 + PRESS_SLOP_PX, 200)]);
    expect(state.phase).toBe("pressed");
  });

  test("travelling past the slop gives the pointer to the scroll", () => {
    const { state, effects } = run([down(), move(100, 200 + PRESS_SLOP_PX + 1), hold(2000), up()]);
    expect(effects).toEqual(["arm", "none", "none", "none"]);
    expect(state).toEqual(IDLE);
  });

  test("the browser taking the touch cancels the press", () => {
    const { state, effects } = run([down(), cancel()]);
    expect(effects).toEqual(["arm", "none"]);
    expect(state).toEqual(IDLE);
  });

  test("a press off the words never marks, however long it is held", () => {
    const { state, effects } = run([down({ onWords: false }), hold(5000)]);
    expect(effects).toEqual(["none", "none"]);
    expect(state.phase).toBe("pressed");
  });
});

describe("a mark being drawn", () => {
  const marking = run([down(), hold(1000 + LONG_PRESS_MS)]).state;

  test("every move extends it and the lift commits it", () => {
    const { state, effects } = run([move(140, 200), move(180, 230), up(180, 230)], marking);
    expect(effects).toEqual(["extend-mark", "extend-mark", "commit-mark"]);
    expect(state).toEqual(IDLE);
  });

  test("a cancel abandons it", () => {
    const { state, effects } = run([cancel()], marking);
    expect(effects).toEqual(["abandon-mark"]);
    expect(state).toEqual(IDLE);
  });

  test("another pointer's events are not its", () => {
    const { state, effects } = run([move(140, 200, 1100, 2), up(140, 200, 1200, 2)], marking);
    expect(effects).toEqual(["none", "none"]);
    expect(state).toBe(marking);
  });

  test("the touch is taken off the browser only while marking", () => {
    expect(claimsTouch(IDLE)).toBe(false);
    expect(claimsTouch(run([down()]).state)).toBe(false);
    expect(claimsTouch(marking)).toBe(true);
  });
});

describe("with the highlight pen in hand", () => {
  test("a press on the words starts a mark at once", () => {
    const { state, effects } = run([down({ tool: "highlight" })]);
    expect(effects).toEqual(["start-mark"]);
    expect(state.phase).toBe("marking");
  });

  test("a press off the words is an ordinary press", () => {
    const { state, effects } = run([down({ tool: "highlight", onWords: false }), move(100, 260), up(100, 260)]);
    expect(effects).toEqual(["none", "none", "none"]);
    expect(state).toEqual(IDLE);
  });

  test("a drag draws, the lift commits", () => {
    const { effects } = run([down({ tool: "highlight" }), move(160, 200), up(160, 200)]);
    expect(effects).toEqual(["start-mark", "extend-mark", "commit-mark"]);
  });
});

describe("the word under a caret", () => {
  test("inside a word", () => {
    expect(wordBoundsAt("the quick brown", 6)).toEqual({ start: 4, end: 9 });
  });
  test("at the start and the end of a word", () => {
    expect(wordBoundsAt("the quick brown", 4)).toEqual({ start: 4, end: 9 });
    expect(wordBoundsAt("the quick brown", 9)).toEqual({ start: 4, end: 9 });
  });
  test("on a space between words: the word before it", () => {
    expect(wordBoundsAt("the quick", 3)).toEqual({ start: 0, end: 3 });
    expect(wordBoundsAt("the  quick", 4)).toEqual({ start: 4, end: 4 });
  });
  test("CJK has no spaces: one character", () => {
    expect(wordBoundsAt("具身智能", 2)).toEqual({ start: 2, end: 3 });
  });
  test("nothing but whitespace: empty at the offset", () => {
    expect(wordBoundsAt("   ", 1)).toEqual({ start: 1, end: 1 });
  });
});

describe("the height a document is guessed at", () => {
  test("grows with the text and never below a screenful", () => {
    expect(intrinsicHeightEstimate(0, 393, FLOW_DISPLAY_DEFAULT)).toBe(120);
    const short = intrinsicHeightEstimate(2000, 393, FLOW_DISPLAY_DEFAULT);
    const long = intrinsicHeightEstimate(200000, 393, FLOW_DISPLAY_DEFAULT);
    expect(long).toBeGreaterThan(short * 50);
  });
  test("bigger type is a taller guess for the same text", () => {
    const small = intrinsicHeightEstimate(20000, 393, { ...FLOW_DISPLAY_DEFAULT, fontPx: 14 });
    const large = intrinsicHeightEstimate(20000, 393, { ...FLOW_DISPLAY_DEFAULT, fontPx: 21 });
    expect(large).toBeGreaterThan(small);
  });
  test("and so is a wider margin, which leaves the line less room", () => {
    const narrow = intrinsicHeightEstimate(20000, 393, { ...FLOW_DISPLAY_DEFAULT, padX: 20 });
    const wide = intrinsicHeightEstimate(20000, 393, { ...FLOW_DISPLAY_DEFAULT, padX: 36 });
    expect(wide).toBeGreaterThan(narrow);
  });
  test("is about the lines the text fills", () => {
    // 41 characters a line at 17px on a 393px column, 1000 characters: 25 lines.
    const h = intrinsicHeightEstimate(1000, 393, FLOW_DISPLAY_DEFAULT);
    const { fontPx, lineHeight } = FLOW_DISPLAY_DEFAULT;
    expect(h).toBeGreaterThan(25 * fontPx * lineHeight);
    expect(h).toBeLessThan(30 * fontPx * lineHeight + 48);
  });
});
