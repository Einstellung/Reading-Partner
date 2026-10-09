// What a hold on Lumen opens (src/ui/components/lumen/lumen-menu.ts). Run: bun test.

import { expect, test } from "bun:test";
import {
  MENU_REST,
  lumenMenuStep,
  menuItemAt,
  menuItems,
  startsHold,
  type LumenMenuInput,
  type LumenMenuState,
  type LumenMenuEffect,
} from "../../../../src/ui/components/lumen/lumen-menu";

const idle = { live: false, canVoice: true };

function run(inputs: LumenMenuInput[], from: LumenMenuState = MENU_REST) {
  let state = from;
  const effects: LumenMenuEffect[] = [];
  for (const input of inputs) {
    const step = lumenMenuStep(state, input);
    state = step.state;
    if (step.effect) effects.push(step.effect);
  }
  return { state, effects };
}

test("a hold that reaches full charge opens the menu with both rows", () => {
  const { state, effects } = run([{ kind: "down" }, { kind: "fired", ...idle }]);
  expect(state.open).toBe(true);
  expect(state.items).toEqual(["voice", "type"]);
  expect(effects).toEqual([]);
});

test("voice is left out where no call could start", () => {
  const { state } = run([{ kind: "down" }, { kind: "fired", live: false, canVoice: false }]);
  expect(state.items).toEqual(["type"]);
  expect(menuItems(false)).toEqual(["type"]);
});

test("a plain tap on the body does nothing", () => {
  const { state, effects } = run([{ kind: "down" }, { kind: "up", item: null }]);
  expect(state).toEqual(MENU_REST);
  expect(effects).toEqual([]);
});

test("letting go on the body leaves the menu up for a tap", () => {
  const { state, effects } = run([
    { kind: "down" },
    { kind: "fired", ...idle },
    { kind: "up", item: null },
  ]);
  expect(state.open).toBe(true);
  expect(state.press).toBeNull();
  expect(effects).toEqual([]);
  // Then a tap on a row picks it.
  const picked = run([{ kind: "pick", item: "type" }], state);
  expect(picked.effects).toEqual(["type"]);
  expect(picked.state.open).toBe(false);
});

test("press and slide: the row under the finger lights, and letting go there picks it", () => {
  const slid = run([
    { kind: "down" },
    { kind: "fired", ...idle },
    { kind: "slide", item: "type" },
  ]);
  expect(slid.state.hot).toBe("type");
  const off = run([{ kind: "slide", item: null }], slid.state);
  expect(off.state.hot).toBeNull();
  const done = run([{ kind: "slide", item: "voice" }, { kind: "up", item: "voice" }], off.state);
  expect(done.effects).toEqual(["voice"]);
  expect(done.state).toEqual(MENU_REST);
});

test("a slide before full charge is not a slide", () => {
  const open = run([{ kind: "context", ...idle }]).state;
  const { state } = run([{ kind: "down" }, { kind: "slide", item: "voice" }], open);
  expect(state.hot).toBeNull();
});

test("letting go over a row the menu does not offer picks nothing", () => {
  const { state, effects } = run([
    { kind: "down" },
    { kind: "fired", live: false, canVoice: false },
    { kind: "up", item: "voice" },
  ]);
  expect(effects).toEqual([]);
  expect(state.open).toBe(true);
});

test("a tap on the body with the menu up puts it away", () => {
  const open = run([{ kind: "down" }, { kind: "fired", ...idle }, { kind: "up", item: null }]).state;
  const { state, effects } = run([{ kind: "down" }, { kind: "up", item: null }], open);
  expect(state.open).toBe(false);
  expect(effects).toEqual([]);
});

test("during a call a hold hangs up, with no menu", () => {
  const { state, effects } = run([
    { kind: "down" },
    { kind: "fired", live: true, canVoice: true },
    { kind: "slide", item: "type" },
    { kind: "up", item: "type" },
  ]);
  expect(effects).toEqual(["hang-up"]);
  expect(state).toEqual(MENU_REST);
});

test("a right-click opens the same menu, and during a call hangs up", () => {
  const opened = run([{ kind: "context", ...idle }]);
  expect(opened.state.open).toBe(true);
  expect(opened.state.items).toEqual(["voice", "type"]);
  expect(opened.effects).toEqual([]);
  expect(run([{ kind: "context", live: true, canVoice: true }]).effects).toEqual(["hang-up"]);
});

test("a context menu raised by a long touch already on the body is ignored", () => {
  const { state } = run([{ kind: "down" }, { kind: "context", ...idle }]);
  expect(state.open).toBe(false);
});

test("only the mouse's main button starts a hold; a finger or pen always does", () => {
  expect(startsHold("mouse", 0)).toBe(true);
  expect(startsHold("mouse", 2)).toBe(false);
  expect(startsHold("touch", 0)).toBe(true);
  expect(startsHold("pen", 0)).toBe(true);
});

test("a press taken over by a drag leaves the menu where it was until dismissed", () => {
  const open = run([{ kind: "context", ...idle }]).state;
  const { state } = run([{ kind: "down" }, { kind: "cancel" }, { kind: "dismiss" }], open);
  expect(state.open).toBe(false);
  expect(state.press).toBeNull();
});

test("the row a point is over, by the rows' boxes", () => {
  const rows = [
    { item: "voice" as const, rect: { left: 100, top: 500, right: 240, bottom: 546 } },
    { item: "type" as const, rect: { left: 100, top: 546, right: 240, bottom: 592 } },
  ];
  expect(menuItemAt(150, 520, rows)).toBe("voice");
  expect(menuItemAt(150, 560, rows)).toBe("type");
  expect(menuItemAt(90, 560, rows)).toBeNull();
  expect(menuItemAt(150, 640, rows)).toBeNull();
});
