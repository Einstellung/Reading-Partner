// The hold-to-talk gesture (src/ai/voice/hold-machine.ts): the three landing
// zones and the four races. A reducer, so every case is a fold over a list of
// events. Run: bun test.

import { expect, test } from "bun:test";
import {
  INITIAL_HOLD_STATE,
  NO_SPEECH_HINT,
  holdReducer,
  type HoldEffect,
  type HoldEvent,
  type HoldState,
} from "../../../src/ai/voice/hold-machine";

// Drive the machine and keep both the state it ended in and every effect it
// asked for along the way.
function run(events: HoldEvent[], from: HoldState = INITIAL_HOLD_STATE) {
  let state = from;
  const effects: HoldEffect[] = [];
  for (const e of events) {
    const result = holdReducer(state, e);
    const { effects: emitted, ...rest } = result;
    effects.push(...emitted);
    state = rest;
  }
  return { state, effects };
}

const HOLDING: HoldEvent[] = [{ type: "down" }, { type: "started" }];

test("a press starts the recognizer and clears any hint", () => {
  const { state, effects } = run([{ type: "down" }]);
  expect(state.status).toBe("arming");
  expect(effects).toEqual([{ type: "hint", message: null }, { type: "start" }]);
});

test("release in the send zone stops, then sends what came back", () => {
  const { state, effects } = run([
    ...HOLDING,
    { type: "event", event: { kind: "final", text: "Chapter three" } },
    { type: "up" },
    { type: "finished", text: "Chapter three, in short." },
  ]);
  expect(effects).toContainEqual({ type: "stop" });
  expect(effects).toContainEqual({ type: "send", text: "Chapter three, in short." });
  expect(state).toEqual(INITIAL_HOLD_STATE);
});

test("release in the edit zone puts the text in the composer instead of sending", () => {
  const { effects } = run([
    ...HOLDING,
    { type: "zone", zone: "edit" },
    { type: "up" },
    { type: "finished", text: "let me fix this" },
  ]);
  expect(effects).toContainEqual({ type: "insert", text: "let me fix this" });
  expect(effects.some((e) => e.type === "send")).toBe(false);
});

test("release in the cancel zone drops the recording and asks for no text", () => {
  const { state, effects } = run([
    ...HOLDING,
    { type: "event", event: { kind: "final", text: "never mind" } },
    { type: "zone", zone: "cancel" },
    { type: "up" },
  ]);
  expect(effects).toContainEqual({ type: "cancel" });
  expect(effects.some((e) => e.type === "stop")).toBe(false);
  expect(state).toEqual(INITIAL_HOLD_STATE);
});

test("sliding back out of cancel sends again", () => {
  const { effects } = run([
    ...HOLDING,
    { type: "zone", zone: "cancel" },
    { type: "zone", zone: "send" },
    { type: "up" },
    { type: "finished", text: "on second thought" },
  ]);
  expect(effects).toContainEqual({ type: "send", text: "on second thought" });
});

test("a hold that produced no words says so instead of sending an empty message", () => {
  const { effects } = run([...HOLDING, { type: "up" }, { type: "finished", text: "   " }]);
  expect(effects).toContainEqual({ type: "hint", message: NO_SPEECH_HINT });
  expect(effects.some((e) => e.type === "send")).toBe(false);
});

// Race 1.
test("a release before the recognizer is up cancels it once it comes up", () => {
  const { state, effects } = run([{ type: "down" }, { type: "up" }, { type: "started" }]);
  expect(effects.filter((e) => e.type === "cancel")).toHaveLength(1);
  expect(effects.some((e) => e.type === "stop")).toBe(false);
  expect(state.status).toBe("idle");
});

test("a start that fails reports its hint even though the press is over", () => {
  const { state, effects } = run([
    { type: "down" },
    { type: "up" },
    { type: "failed", message: "Speech recognition is off in Settings." },
  ]);
  expect(effects).toContainEqual({
    type: "hint",
    message: "Speech recognition is off in Settings.",
  });
  expect(state.status).toBe("idle");
});

// Race 2.
test("nothing restarts while the flush is in flight", () => {
  const held = run([...HOLDING, { type: "up" }]);
  expect(held.state.status).toBe("finishing");
  const during = run([{ type: "down" }, { type: "up" }, { type: "zone", zone: "cancel" }], held.state);
  expect(during.effects).toEqual([]);
  expect(during.state.status).toBe("finishing");
  expect(during.state.zone).toBe("send");
});

// Race 3.
test("unmounting mid-listen cancels exactly once", () => {
  const { state, effects } = run([...HOLDING, { type: "unmount" }]);
  expect(effects.filter((e) => e.type === "cancel")).toHaveLength(1);
  expect(state.status).toBe("idle");
});

test("unmounting while arming still cancels the run that is about to start", () => {
  const gone = run([{ type: "down" }, { type: "unmount" }]);
  expect(gone.state.status).toBe("aborting");
  const { effects } = run([{ type: "started" }], gone.state);
  expect(effects).toEqual([{ type: "cancel" }]);
});

test("unmounting during the flush leaves the recognizer alone", () => {
  const { state, effects } = run([...HOLDING, { type: "up" }, { type: "unmount" }]);
  expect(effects.some((e) => e.type === "cancel")).toBe(false);
  expect(state.status).toBe("idle");
});

// Race 4.
test("a flush that never comes back sends what streamed in", () => {
  const { effects } = run([
    ...HOLDING,
    { type: "event", event: { kind: "final", text: "the first half" } },
    { type: "event", event: { kind: "volatile", text: "and the tail" } },
    { type: "up" },
    { type: "timeout" },
  ]);
  expect(effects).toContainEqual({ type: "send", text: "the first half and the tail" });
});

test("a flush that arrives after the timeout is ignored", () => {
  const { state, effects } = run([
    ...HOLDING,
    { type: "event", event: { kind: "final", text: "early" } },
    { type: "up" },
    { type: "timeout" },
    { type: "finished", text: "early and late" },
  ]);
  expect(effects.filter((e) => e.type === "send")).toEqual([{ type: "send", text: "early" }]);
  expect(state).toEqual(INITIAL_HOLD_STATE);
});

test("a failed flush still delivers the words that streamed in", () => {
  const { effects } = run([
    ...HOLDING,
    { type: "event", event: { kind: "final", text: "said something" } },
    { type: "up" },
    { type: "failed", message: "dictation ended unexpectedly" },
  ]);
  expect(effects).toContainEqual({ type: "send", text: "said something" });
});

test("a failed flush with nothing streamed reports the failure", () => {
  const { effects } = run([
    ...HOLDING,
    { type: "up" },
    { type: "failed", message: "dictation ended unexpectedly" },
  ]);
  expect(effects).toContainEqual({ type: "hint", message: "dictation ended unexpectedly" });
});

test("the level tracks the last level event and resets on release", () => {
  const listening = run([...HOLDING, { type: "event", event: { kind: "level", value: 0.7 } }]);
  expect(listening.state.level).toBeCloseTo(0.7);
  const released = run([{ type: "up" }], listening.state);
  expect(released.state.level).toBe(0);
});

test("a new hold starts from an empty transcript", () => {
  const first = run([
    ...HOLDING,
    { type: "event", event: { kind: "final", text: "first message" } },
    { type: "up" },
    { type: "finished", text: "first message" },
  ]);
  const second = run([...HOLDING, { type: "up" }, { type: "timeout" }], first.state);
  expect(second.effects).toContainEqual({ type: "hint", message: NO_SPEECH_HINT });
});
