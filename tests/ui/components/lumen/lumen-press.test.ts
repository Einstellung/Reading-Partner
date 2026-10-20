// What a press on Lumen means (src/ui/components/lumen/lumen-press.ts, docs/68):
// a tap opens the conversation, a press that travels is a drag and opens nothing.
// Run: scripts/t.sh tests/ui/components/lumen/lumen-press.test.ts

import { expect, test } from "bun:test";

import {
  PRESS_REST,
  lumenPressStep,
  startsPress,
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

test("a drag opens nothing", () => {
  expect(run([{ kind: "down" }, { kind: "dragged" }, { kind: "up" }, { kind: "click" }]).effects).toEqual([]);
});

test("a second finger is not a second press", () => {
  expect(run([{ kind: "down" }, { kind: "down" }, { kind: "up" }]).effects).toEqual(["open-door"]);
});

test("only the click its own release brings is swallowed", () => {
  const { effects } = run([{ kind: "down" }, { kind: "dragged" }, { kind: "up" }, { kind: "click" }, { kind: "click" }]);
  expect(effects).toEqual(["open-door"]);
});

test("a cancelled press leaves nothing to swallow", () => {
  const { state } = run([{ kind: "down" }, { kind: "cancel" }]);
  expect(state).toEqual(PRESS_REST);
});

test("a mouse's other buttons never start a press", () => {
  expect(startsPress("mouse", 0)).toBe(true);
  expect(startsPress("mouse", 2)).toBe(false);
  expect(startsPress("touch", 0)).toBe(true);
  expect(startsPress("pen", 0)).toBe(true);
});
