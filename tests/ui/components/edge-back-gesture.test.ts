// The phone shell's left-edge back swipe: where it may start, what abandons it
// to the page underneath, and what a release resolves to.

import { expect, test } from "bun:test";
import {
  AXIS_RATIO,
  COMMIT_FRACTION,
  COMMIT_VELOCITY,
  EDGE_ZONE,
  SLOP,
  TOUCH_CLAIM_PX,
  classifyMove,
  inEdgeZone,
  initEdgeBackState,
  resolveEdgeBack,
  shouldClaimTouch,
  stepEdgeBack,
  type EdgeBackCommand,
  type EdgeBackInput,
  type EdgeBackState,
} from "../../../src/ui/components/phone/edge-back-gesture";

const WIDTH = 393; // iPhone 16 (docs/22)

function last(commands: EdgeBackCommand[]): EdgeBackCommand | undefined {
  return commands[commands.length - 1];
}

function drive(inputs: EdgeBackInput[]): { state: EdgeBackState; commands: EdgeBackCommand[] } {
  let state = initEdgeBackState();
  const commands: EdgeBackCommand[] = [];
  for (const input of inputs) {
    const next = stepEdgeBack(state, input, { width: WIDTH });
    state = next.state;
    commands.push(...next.commands);
  }
  return { state, commands };
}

// A slow, deliberate drag: one sample every 100ms, so velocity never reaches
// the fling threshold and only the distance decides.
function slowDrag(from: number, to: number, y = 400): EdgeBackInput[] {
  const inputs: EdgeBackInput[] = [{ type: "pointerdown", id: 1, x: from, y, t: 0 }];
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    inputs.push({
      type: "pointermove",
      id: 1,
      x: from + ((to - from) * i) / steps,
      y,
      t: i * 100,
    });
  }
  inputs.push({ type: "pointerup", id: 1, x: to, y, t: steps * 100 });
  return inputs;
}

test("the band is the left edge only", () => {
  expect(inEdgeZone(0, EDGE_ZONE)).toBe(true);
  expect(inEdgeZone(EDGE_ZONE, EDGE_ZONE)).toBe(true);
  expect(inEdgeZone(EDGE_ZONE + 1, EDGE_ZONE)).toBe(false);
  // The middle of the page, where a wide table may want to scroll sideways.
  expect(inEdgeZone(WIDTH / 2, EDGE_ZONE)).toBe(false);
});

test("a move is only a back once it is rightward and horizontally dominant", () => {
  expect(classifyMove(2, 2, SLOP, AXIS_RATIO)).toBe("wait");
  expect(classifyMove(SLOP + 4, 0, SLOP, AXIS_RATIO)).toBe("back");
  expect(classifyMove(-(SLOP + 4), 0, SLOP, AXIS_RATIO)).toBe("abandon");
  expect(classifyMove(0, SLOP + 4, SLOP, AXIS_RATIO)).toBe("abandon");
  expect(classifyMove(0, -(SLOP + 4), SLOP, AXIS_RATIO)).toBe("abandon");
  // Diagonal: neither axis wins by the ratio, so the move has not resolved yet.
  expect(classifyMove(20, 19, SLOP, AXIS_RATIO)).toBe("wait");
});

test("the touch is claimed early, and only by a clearly rightward move", () => {
  // Far below the slop on purpose: the browser decides a touch is a scroll
  // before the gesture has resolved (docs/pitfall/70).
  expect(TOUCH_CLAIM_PX).toBeLessThan(SLOP);
  expect(shouldClaimTouch(TOUCH_CLAIM_PX, 0)).toBe(true);
  expect(shouldClaimTouch(TOUCH_CLAIM_PX - 0.5, 0)).toBe(false);
  expect(shouldClaimTouch(-20, 0)).toBe(false);
  // A drag that is going down as much as it is going right belongs to the page.
  expect(shouldClaimTouch(6, 6)).toBe(false);
  expect(shouldClaimTouch(6, -6)).toBe(false);
  expect(shouldClaimTouch(20, 4)).toBe(true);
});

test("a release goes back on distance or on a fling", () => {
  const commit = WIDTH * COMMIT_FRACTION;
  expect(resolveEdgeBack(commit, 0, WIDTH, COMMIT_FRACTION, COMMIT_VELOCITY)).toBe(true);
  expect(resolveEdgeBack(commit - 1, 0, WIDTH, COMMIT_FRACTION, COMMIT_VELOCITY)).toBe(false);
  // A flick wins by direction, however short.
  expect(resolveEdgeBack(20, COMMIT_VELOCITY, WIDTH, COMMIT_FRACTION, COMMIT_VELOCITY)).toBe(true);
  // And a flick back cancels, however far the finger got.
  expect(resolveEdgeBack(WIDTH * 0.8, -COMMIT_VELOCITY, WIDTH, COMMIT_FRACTION, COMMIT_VELOCITY)).toBe(
    false,
  );
});

test("a drag from the edge past the commit distance goes back, following the finger", () => {
  const { commands } = drive(slowDrag(6, 6 + WIDTH * 0.5));
  expect(commands[0]).toEqual({ type: "capture", id: 1 });
  const moves = commands.filter((c) => c.type === "dragMove");
  expect(moves.length).toBeGreaterThan(1);
  // Follows the finger: every offset is the distance travelled, and it grows.
  expect(moves.map((m) => (m as { dx: number }).dx)).toEqual(
    moves.map((m) => (m as { dx: number }).dx).sort((a, b) => a - b),
  );
  expect(last(commands)).toEqual({ type: "dragEnd", back: true });
});

test("a short drag from the edge springs back instead", () => {
  const { commands } = drive(slowDrag(6, 6 + WIDTH * 0.2));
  expect(last(commands)).toEqual({ type: "dragEnd", back: false });
});

test("a drag that starts away from the edge is never taken", () => {
  const { commands, state } = drive(slowDrag(WIDTH / 2, WIDTH / 2 + WIDTH * 0.6));
  expect(commands).toEqual([]);
  expect(state).toEqual(initEdgeBackState());
});

test("a vertical drag from the edge is left to the page", () => {
  const { commands } = drive([
    { type: "pointerdown", id: 1, x: 8, y: 400, t: 0 },
    { type: "pointermove", id: 1, x: 10, y: 340, t: 100 },
    { type: "pointermove", id: 1, x: 12, y: 260, t: 200 },
    { type: "pointerup", id: 1, x: 12, y: 260, t: 300 },
  ]);
  expect(commands).toEqual([]);
});

test("the page cancelling the pointer ends the drag without going back", () => {
  const { commands } = drive([
    { type: "pointerdown", id: 1, x: 8, y: 400, t: 0 },
    { type: "pointermove", id: 1, x: 60, y: 400, t: 100 },
    { type: "pointermove", id: 1, x: 200, y: 400, t: 200 },
    { type: "pointercancel", id: 1 },
  ]);
  expect(last(commands)).toEqual({ type: "dragEnd", back: false });
});

test("dragging back past the start never pushes the screen off the other side", () => {
  const { commands } = drive([
    { type: "pointerdown", id: 1, x: 8, y: 400, t: 0 },
    { type: "pointermove", id: 1, x: 60, y: 400, t: 100 },
    { type: "pointermove", id: 1, x: 0, y: 400, t: 200 },
    { type: "pointerup", id: 1, x: 0, y: 400, t: 300 },
  ]);
  const moves = commands.filter((c) => c.type === "dragMove") as { dx: number }[];
  expect(Math.min(...moves.map((m) => m.dx))).toBe(0);
});

test("a second finger abandons a drag in flight and the first one cannot restart it", () => {
  const { commands, state } = drive([
    { type: "pointerdown", id: 1, x: 8, y: 400, t: 0 },
    { type: "pointermove", id: 1, x: 60, y: 400, t: 100 },
    { type: "pointerdown", id: 2, x: 200, y: 400, t: 150 },
    { type: "pointermove", id: 1, x: 300, y: 400, t: 200 },
    { type: "pointerup", id: 2, x: 200, y: 400, t: 250 },
  ]);
  expect(last(commands)).toEqual({ type: "dragEnd", back: false });
  expect(state.phase).toBe("off");
  // Still off with one finger left on the glass: it is not a fresh gesture.
  const after = stepEdgeBack(state, { type: "pointermove", id: 1, x: 350, y: 400, t: 300 }, {
    width: WIDTH,
  });
  expect(after.commands).toEqual([]);
});

test("every pointer lifting returns the machine to rest", () => {
  const { state } = drive(slowDrag(6, 6 + WIDTH * 0.5));
  expect(state).toEqual(initEdgeBackState());
});
