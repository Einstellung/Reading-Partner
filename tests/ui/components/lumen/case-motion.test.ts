// The case being pulled out and put away (docs/68). Three things are worth a
// test and they are all here: the path — hidden inside the body, clear of it
// where it changes layer, and exactly caseRect() at the end — the clock, which
// has to turn round mid-way without a jump, and the reach the body reads.
//
// Run: bun test.

import { expect, test } from "bun:test";

import { caseRect } from "../../../../src/ui/components/lumen/case-box";
import {
  BEHIND_SCALE,
  BODY_CIRCLE,
  CASE_LEAN_DEG,
  CASE_START,
  PULL_MS,
  PUT_MS,
  SWITCH_P,
  aimCase,
  caseAtRest,
  caseDrawn,
  caseLeanDeg,
  caseLookGaze,
  casePose,
  caseReach,
  caseSettled,
  caseTriggerStyle,
  stepCase,
  type CaseMotion,
} from "../../../../src/ui/components/lumen/case-motion";

function corners(p: number) {
  const box = casePose(p);
  return [
    { x: box.left, y: box.bottom },
    { x: box.left + box.width, y: box.bottom },
    { x: box.left, y: box.bottom + box.height },
    { x: box.left + box.width, y: box.bottom + box.height },
  ];
}

test("hidden is inside the round body, with nothing peeking out", () => {
  for (const corner of corners(0)) {
    expect(Math.hypot(corner.x - BODY_CIRCLE.x, corner.y - BODY_CIRCLE.y)).toBeLessThan(
      BODY_CIRCLE.r,
    );
  }
  expect(casePose(0).behind).toBe(true);
  // Smaller than it ends up, which is what the last leg grows back.
  expect(casePose(0).width).toBeCloseTo(caseRect().width * BEHIND_SCALE, 9);
});

test("the end of the path is the resting spot itself, not a number near it", () => {
  const rest = caseRect();
  const pose = casePose(1);
  expect(pose.left).toBe(rest.left);
  expect(pose.bottom).toBe(rest.bottom);
  expect(pose.width).toBe(rest.width);
  expect(pose.height).toBe(rest.height);
  expect(pose.behind).toBe(false);
});

test("it changes layer where it does not overlap the body, so there is no pop", () => {
  for (const p of [SWITCH_P - 0.03, SWITCH_P - 0.01, SWITCH_P, SWITCH_P + 0.01, SWITCH_P + 0.03]) {
    const pose = casePose(p);
    expect(pose.left + pose.width).toBeLessThan(BODY_CIRCLE.left);
  }
  // Behind up to the switch and in front after it, once each way.
  const flips = [];
  let was = casePose(0).behind;
  for (let p = 0; p <= 1.0001; p += 0.001) {
    const now = casePose(p).behind;
    if (now !== was) flips.push(p);
    was = now;
  }
  expect(flips.length).toBe(1);
  expect(flips[0]).toBeCloseTo(SWITCH_P, 2);
});

test("out from behind is down and to the left, and the last leg comes back down and right", () => {
  const hidden = casePose(0);
  const out = casePose(SWITCH_P);
  const rest = casePose(1);
  expect(out.left).toBeLessThan(hidden.left);
  expect(out.bottom).toBeLessThan(hidden.bottom);
  expect(rest.left).toBeGreaterThan(out.left);
  expect(rest.bottom).toBeLessThan(out.bottom);
  // Toward the viewer on the way down.
  expect(out.width).toBeLessThan(rest.width);
});

test("the path has no step in it", () => {
  let before = casePose(0);
  for (let p = 0.001; p <= 1.0001; p += 0.001) {
    const now = casePose(p);
    // A thousandth of the trip moves it less than a hundredth of the box,
    // which at the 72px corner is under a pixel.
    expect(Math.abs(now.left - before.left)).toBeLessThan(0.01);
    expect(Math.abs(now.bottom - before.bottom)).toBeLessThan(0.01);
    expect(Math.abs(now.width - before.width)).toBeLessThan(0.01);
    before = now;
  }
});

test("the trigger's box grows the touch target outwards and hides behind the body", () => {
  const behind = caseTriggerStyle(0.2);
  const rest = caseTriggerStyle(1);
  expect(behind.zIndex).toBe(-1);
  expect(rest.zIndex).toBeUndefined();
  expect(rest.padding).toBe("10px");
  expect(String(rest.left)).toContain("calc(");
});

// The clock.

test("the first reading of the count is not an act", () => {
  const full = aimCase(CASE_START, 3);
  expect(full).toEqual({ p: 1, target: 1, read: true });
  expect(caseAtRest(full)).toBe(true);
  const empty = aimCase(CASE_START, 0);
  expect(empty).toEqual({ p: 0, target: 0, read: true });
  expect(caseDrawn(empty)).toBe(false);
  // And the second reading of the same count is nothing at all.
  expect(aimCase(empty, 0)).toBe(empty);
  expect(aimCase(full, 3)).toBe(full);
});

test("a rise is a pull-out and takes its own time; a fall is a put-away", () => {
  let state = aimCase(CASE_START, 0);
  state = aimCase(state, 1);
  expect(state.target).toBe(1);
  expect(state.p).toBe(0);
  expect(caseDrawn(state)).toBe(true);
  expect(caseSettled(state)).toBe(false);

  state = stepCase(state, PULL_MS / 2);
  expect(state.p).toBeCloseTo(0.5, 6);
  state = stepCase(state, PULL_MS / 2);
  expect(state.p).toBe(1);
  expect(caseAtRest(state)).toBe(true);
  // Past the end it stays at the end.
  expect(stepCase(state, 1000)).toBe(state);

  // A second item is only a number: the case is already out.
  expect(aimCase(state, 2)).toBe(state);

  state = aimCase(state, 0);
  expect(state.target).toBe(0);
  state = stepCase(state, PUT_MS);
  expect(state.p).toBe(0);
  expect(caseDrawn(state)).toBe(false);
});

test("the box emptying mid-pull turns the case round from where it is", () => {
  let state: CaseMotion = aimCase(aimCase(CASE_START, 0), 1);
  state = stepCase(state, PULL_MS * 0.4);
  const caught = state.p;
  expect(caught).toBeCloseTo(0.4, 6);

  state = aimCase(state, 0);
  // No jump: the same progress, headed the other way.
  expect(state.p).toBe(caught);
  expect(state.target).toBe(0);

  state = stepCase(state, PUT_MS * 0.2);
  expect(state.p).toBeCloseTo(0.2, 6);

  // And an item arriving during the put-away turns it round again.
  state = aimCase(state, 1);
  expect(state.p).toBeCloseTo(0.2, 6);
  expect(state.target).toBe(1);
  state = stepCase(state, PULL_MS);
  expect(state.p).toBe(1);
});

test("reduced motion has no path at all", () => {
  const started = aimCase(CASE_START, 0);
  const out = aimCase(started, 2, true);
  expect(out).toEqual({ p: 1, target: 1, read: true });
  expect(caseSettled(out)).toBe(true);
  const away = aimCase(out, 0, true);
  expect(away).toEqual({ p: 0, target: 0, read: true });
  expect(aimCase(away, 0, true)).toBe(away);
});

// The body.

test("the reach comes on and goes off, and is nothing at either end", () => {
  expect(caseReach(0)).toBe(0);
  expect(caseReach(1)).toBe(0);
  expect(caseReach(0.5)).toBe(1);
  expect(caseReach(0.1)).toBeGreaterThan(0);
  expect(caseReach(0.1)).toBeLessThan(1);
  expect(caseReach(0.9)).toBeCloseTo(caseReach(0.1), 9);
  // It only ever climbs on the way out and falls on the way back.
  for (let p = 0.001; p < 0.5; p += 0.001) {
    expect(caseReach(p)).toBeGreaterThanOrEqual(caseReach(p - 0.001));
  }
});

test("the eyes go to the case on the lower left and the body leans that way", () => {
  const look = caseLookGaze(1);
  expect(look.x).toBeLessThan(0);
  expect(look.y).toBeGreaterThan(0);
  expect(Math.hypot(look.x, look.y)).toBeCloseTo(1, 6);
  expect(caseLookGaze(0).x).toBeCloseTo(0, 9);
  expect(caseLookGaze(0).y).toBeCloseTo(0, 9);
  expect(caseLookGaze(0.5).x).toBeCloseTo(look.x / 2, 9);

  // Counter-clockwise about the feet: the head goes out over the case.
  expect(CASE_LEAN_DEG).toBeLessThan(0);
  expect(Math.abs(CASE_LEAN_DEG)).toBeLessThan(8);
  expect(caseLeanDeg(1)).toBe(CASE_LEAN_DEG);
  expect(caseLeanDeg(0)).toBeCloseTo(0, 9);
});
