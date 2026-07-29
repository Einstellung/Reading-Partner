// The phone shell's pull-down-to-ask gesture: when it may start, what abandons
// it to the scroll underneath, how far the surface follows, and what a release
// resolves to.

import { expect, test } from "bun:test";
import {
  AXIS_RATIO,
  CANCEL_VELOCITY,
  COMMIT_DISTANCE,
  MAX_PULL,
  SLOP,
  TOP_EPSILON,
  TOUCH_CLAIM_PX,
  classifyMove,
  followPull,
  initPullToAskState,
  isAtTop,
  resolvePullToAsk,
  shouldClaimTouch,
  stepPullToAsk,
  type PullToAskCommand,
  type PullToAskInput,
  type PullToAskState,
} from "../../../src/ui/components/phone/pull-to-ask-gesture";
import {
  AXIS_RATIO as BACK_AXIS_RATIO,
  classifyMove as classifyBack,
  shouldClaimTouch as shouldClaimBack,
} from "../../../src/ui/components/phone/edge-back-gesture";

function last(commands: PullToAskCommand[]): PullToAskCommand | undefined {
  return commands[commands.length - 1];
}

function drive(inputs: PullToAskInput[]): { state: PullToAskState; commands: PullToAskCommand[] } {
  let state = initPullToAskState();
  const commands: PullToAskCommand[] = [];
  for (const input of inputs) {
    const next = stepPullToAsk(state, input);
    state = next.state;
    commands.push(...next.commands);
  }
  return { state, commands };
}

// A slow, deliberate pull: one sample every 100ms, so velocity never reaches the
// fling threshold and only the distance decides.
function slowPull(to: number, atTop = true, x = 200): PullToAskInput[] {
  const from = 200;
  const inputs: PullToAskInput[] = [{ type: "pointerdown", id: 1, x, y: from, t: 0, atTop }];
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    inputs.push({ type: "pointermove", id: 1, x, y: from + (to * i) / steps, t: i * 100 });
  }
  inputs.push({ type: "pointerup", id: 1, x, y: from + to, t: steps * 100 });
  return inputs;
}

test("the top is the top, give or take a fractional scroll position", () => {
  expect(isAtTop(0)).toBe(true);
  expect(isAtTop(TOP_EPSILON)).toBe(true);
  expect(isAtTop(TOP_EPSILON + 0.5)).toBe(false);
  expect(isAtTop(400)).toBe(false);
});

test("a move is only a pull once it is downward and vertically dominant", () => {
  expect(classifyMove(2, 2, SLOP, AXIS_RATIO)).toBe("wait");
  expect(classifyMove(0, SLOP + 4, SLOP, AXIS_RATIO)).toBe("ask");
  expect(classifyMove(0, -(SLOP + 4), SLOP, AXIS_RATIO)).toBe("abandon");
  expect(classifyMove(SLOP + 4, 0, SLOP, AXIS_RATIO)).toBe("abandon");
  expect(classifyMove(-(SLOP + 4), 0, SLOP, AXIS_RATIO)).toBe("abandon");
  // Diagonal: neither axis wins by the ratio, so the move has not resolved yet.
  expect(classifyMove(19, 20, SLOP, AXIS_RATIO)).toBe("wait");
});

test("the touch is claimed early, and only by a clearly downward move", () => {
  // Far below the slop on purpose: the browser decides a touch is a scroll
  // before the gesture has resolved (docs/pitfall/70), and down is the axis the
  // scroll container itself wants.
  expect(TOUCH_CLAIM_PX).toBeLessThan(SLOP);
  expect(shouldClaimTouch(0, TOUCH_CLAIM_PX)).toBe(true);
  expect(shouldClaimTouch(0, TOUCH_CLAIM_PX - 0.5)).toBe(false);
  expect(shouldClaimTouch(0, -20)).toBe(false);
  // A drag going sideways as much as it is going down belongs to the page.
  expect(shouldClaimTouch(6, 6)).toBe(false);
  expect(shouldClaimTouch(-6, 6)).toBe(false);
  expect(shouldClaimTouch(4, 20)).toBe(true);
});

// The two phone gestures share a finger, so the axis rule has to keep them
// apart without either machine knowing about the other.
test("no move can be both a pull and an edge back", () => {
  expect(AXIS_RATIO).toBe(BACK_AXIS_RATIO);
  for (let dx = -40; dx <= 40; dx += 1) {
    for (let dy = -40; dy <= 40; dy += 1) {
      const pull = classifyMove(dx, dy, SLOP, AXIS_RATIO) === "ask";
      const back = classifyBack(dx, dy, SLOP, AXIS_RATIO) === "back";
      expect(pull && back).toBe(false);
      // And neither raw-touch channel can take a touch the other one wants.
      expect(shouldClaimTouch(dx, dy) && shouldClaimBack(dx, dy)).toBe(false);
    }
  }
});

test("the surface follows the finger to the commit distance, then resists and stops", () => {
  expect(followPull(0)).toBe(0);
  expect(followPull(-30)).toBe(0);
  expect(followPull(40)).toBe(40);
  expect(followPull(COMMIT_DISTANCE)).toBe(COMMIT_DISTANCE);
  // Past the threshold it keeps answering, damped.
  const past = followPull(COMMIT_DISTANCE + 100);
  expect(past).toBeGreaterThan(COMMIT_DISTANCE);
  expect(past).toBeLessThan(COMMIT_DISTANCE + 100);
  expect(followPull(1000)).toBe(MAX_PULL);
});

test("a release asks on distance, and a flick back up always cancels", () => {
  expect(resolvePullToAsk(COMMIT_DISTANCE, 0)).toBe(true);
  expect(resolvePullToAsk(COMMIT_DISTANCE - 1, 0)).toBe(false);
  expect(resolvePullToAsk(COMMIT_DISTANCE * 2, -CANCEL_VELOCITY)).toBe(false);
  // Speed alone never opens the chat: a fast flick down is what arriving at the
  // top of a page looks like.
  expect(resolvePullToAsk(30, 4)).toBe(false);
});

test("a pull past the commit distance opens the chat, following the finger", () => {
  const { commands } = drive(slowPull(COMMIT_DISTANCE + 20));
  expect(commands[0]).toEqual({ type: "capture", id: 1 });
  const moves = commands.filter((c) => c.type === "pullMove") as {
    offset: number;
    armed: boolean;
  }[];
  expect(moves.length).toBeGreaterThan(1);
  expect(moves.map((m) => m.offset)).toEqual(moves.map((m) => m.offset).sort((a, b) => a - b));
  // The affordance is armed before the finger leaves, never only at release.
  expect(moves.some((m) => !m.armed)).toBe(true);
  expect(moves[moves.length - 1].armed).toBe(true);
  expect(last(commands)).toEqual({ type: "pullEnd", ask: true });
});

test("a short pull springs back instead", () => {
  const { commands } = drive(slowPull(COMMIT_DISTANCE - 20));
  const moves = commands.filter((c) => c.type === "pullMove") as { armed: boolean }[];
  expect(moves.every((m) => !m.armed)).toBe(true);
  expect(last(commands)).toEqual({ type: "pullEnd", ask: false });
});

test("a pull that starts below the top is left to the scroll", () => {
  const { commands, state } = drive(slowPull(COMMIT_DISTANCE + 60, false));
  expect(commands).toEqual([]);
  expect(state).toEqual(initPullToAskState());
});

test("scrolling up from the top is not a pull", () => {
  const { commands } = drive([
    { type: "pointerdown", id: 1, x: 200, y: 600, t: 0, atTop: true },
    { type: "pointermove", id: 1, x: 200, y: 540, t: 100 },
    { type: "pointermove", id: 1, x: 200, y: 400, t: 200 },
    { type: "pointerup", id: 1, x: 200, y: 400, t: 300 },
  ]);
  expect(commands).toEqual([]);
});

test("a sideways drag from the top is left alone, so the edge back keeps it", () => {
  const { commands } = drive([
    { type: "pointerdown", id: 1, x: 8, y: 400, t: 0, atTop: true },
    { type: "pointermove", id: 1, x: 60, y: 404, t: 100 },
    { type: "pointermove", id: 1, x: 200, y: 408, t: 200 },
    { type: "pointerup", id: 1, x: 200, y: 408, t: 300 },
  ]);
  expect(commands).toEqual([]);
});

test("the page cancelling the pointer ends the pull without asking", () => {
  const { commands, state } = drive([
    { type: "pointerdown", id: 1, x: 200, y: 200, t: 0, atTop: true },
    { type: "pointermove", id: 1, x: 200, y: 260, t: 100 },
    { type: "pointermove", id: 1, x: 200, y: 400, t: 200 },
    { type: "pointercancel", id: 1 },
  ]);
  expect(last(commands)).toEqual({ type: "pullEnd", ask: false });
  expect(state).toEqual(initPullToAskState());
});

test("pulling back past the start never pushes the screen off the top", () => {
  const { commands } = drive([
    { type: "pointerdown", id: 1, x: 200, y: 200, t: 0, atTop: true },
    { type: "pointermove", id: 1, x: 200, y: 260, t: 100 },
    { type: "pointermove", id: 1, x: 200, y: 120, t: 200 },
    { type: "pointerup", id: 1, x: 200, y: 120, t: 300 },
  ]);
  const moves = commands.filter((c) => c.type === "pullMove") as { offset: number }[];
  expect(Math.min(...moves.map((m) => m.offset))).toBe(0);
  expect(last(commands)).toEqual({ type: "pullEnd", ask: false });
});

test("a second finger abandons a pull in flight and the first one cannot restart it", () => {
  const { commands, state } = drive([
    { type: "pointerdown", id: 1, x: 200, y: 200, t: 0, atTop: true },
    { type: "pointermove", id: 1, x: 200, y: 260, t: 100 },
    { type: "pointerdown", id: 2, x: 100, y: 300, t: 150, atTop: true },
    { type: "pointermove", id: 1, x: 200, y: 400, t: 200 },
    { type: "pointerup", id: 2, x: 100, y: 300, t: 250 },
  ]);
  expect(last(commands)).toEqual({ type: "pullEnd", ask: false });
  expect(state.phase).toBe("off");
  const after = stepPullToAsk(state, { type: "pointermove", id: 1, x: 200, y: 500, t: 300 });
  expect(after.commands).toEqual([]);
});

test("every pointer lifting returns the machine to rest", () => {
  const { state } = drive(slowPull(COMMIT_DISTANCE + 20));
  expect(state).toEqual(initPullToAskState());
});
