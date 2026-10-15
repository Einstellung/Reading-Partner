// What a press on Lumen means (src/ui/components/lumen/lumen-press.ts, docs/68
// 2026-10-15): a tap opens the conversation, a hold talks, a hold during a call
// hangs up, and where there is no call to have a long press is a tap.
// Run: scripts/t.sh tests/ui/components/lumen/lumen-press.test.ts

import { expect, test } from "bun:test";

import {
  PRESS_REST,
  holdEffect,
  lumenPressStep,
  startsHold,
  type LumenPressEffect,
  type LumenPressInput,
  type LumenPressState,
} from "../../../../src/ui/components/lumen/lumen-press";

function run(inputs: LumenPressInput[], from: LumenPressState = PRESS_REST) {
  let state = from;
  const effects: LumenPressEffect[] = [];
  for (const input of inputs) {
    const step = lumenPressStep(state, input);
    state = step.state;
    if (step.effect) effects.push(step.effect);
  }
  return { state, effects };
}

const idle = { live: false, canVoice: true };
const mute = { live: false, canVoice: false };
const inCall = { live: true, canVoice: true };

test("a tap opens the conversation", () => {
  expect(run([{ kind: "down" }, { kind: "up" }, { kind: "click" }]).effects).toEqual(["open-door"]);
});

test("the tap is the release: a long touch that brings no click still opens it, once", () => {
  expect(run([{ kind: "down" }, { kind: "up" }]).effects).toEqual(["open-door"]);
  expect(run([{ kind: "down" }, { kind: "up" }, { kind: "click" }]).effects).toEqual(["open-door"]);
});

test("a keyboard's click, with no press before it, opens the conversation", () => {
  expect(run([{ kind: "click" }]).effects).toEqual(["open-door"]);
});

test("a hold where a call can start starts one, and its release opens nothing", () => {
  const { effects, state } = run([
    { kind: "down" },
    { kind: "fired", ...idle },
    { kind: "up" },
    { kind: "click" },
  ]);
  expect(effects).toEqual(["voice"]);
  expect(state).toEqual(PRESS_REST);
});

test("a hold during a call hangs up", () => {
  expect(run([{ kind: "down" }, { kind: "fired", ...inCall }, { kind: "up" }, { kind: "click" }]).effects).toEqual([
    "hang-up",
  ]);
});

test("where no call can start, a hold opens the conversation", () => {
  expect(holdEffect(mute)).toBe("open-door");
  expect(run([{ kind: "down" }, { kind: "fired", ...mute }, { kind: "up" }, { kind: "click" }]).effects).toEqual([
    "open-door",
  ]);
});

test("a drag opens nothing, and a stale fire after it is ignored", () => {
  expect(
    run([{ kind: "down" }, { kind: "dragged" }, { kind: "fired", ...idle }, { kind: "up" }, { kind: "click" }]).effects,
  ).toEqual([]);
});

test("a press fires once", () => {
  expect(run([{ kind: "down" }, { kind: "fired", ...idle }, { kind: "fired", ...idle }]).effects).toEqual(["voice"]);
});

test("only the click its own release brings is swallowed", () => {
  const { effects } = run([{ kind: "down" }, { kind: "dragged" }, { kind: "up" }, { kind: "click" }, { kind: "click" }]);
  expect(effects).toEqual(["open-door"]);
});

test("a cancelled press leaves nothing to swallow", () => {
  const { state } = run([{ kind: "down" }, { kind: "fired", ...idle }, { kind: "cancel" }]);
  expect(state).toEqual(PRESS_REST);
});

test("a right-click is the hold, and a long touch's context menu is not a second one", () => {
  expect(run([{ kind: "context", ...idle }]).effects).toEqual(["voice"]);
  expect(run([{ kind: "context", ...inCall }]).effects).toEqual(["hang-up"]);
  expect(run([{ kind: "context", ...mute }]).effects).toEqual(["open-door"]);
  expect(run([{ kind: "down" }, { kind: "context", ...idle }]).effects).toEqual([]);
});

test("a mouse's other buttons never start a press", () => {
  expect(startsHold("mouse", 0)).toBe(true);
  expect(startsHold("mouse", 2)).toBe(false);
  expect(startsHold("touch", 0)).toBe(true);
  expect(startsHold("pen", 0)).toBe(true);
});
