// src/smoke/hold-outcome.ts: reading which of the three landing zones a hold
// was released over, from outside the composer. The bench cannot ask — it has a
// send callback, the composer's own shape, and the plugin's event counts — so
// the mapping is worth stating rather than eyeballing on a device, which is a
// build and an install per attempt. Run: bun test.

import { expect, test } from "bun:test";
import {
  NO_HEARD,
  RESOLVE_MS,
  TOO_SHORT_MS,
  classifyHold,
  type Heard,
} from "../../src/smoke/hold-outcome";
import { FINISH_TIMEOUT_MS } from "../../src/ai/voice/hold-machine";

// A hold that ran normally: three seconds of audio at fifteen levels a second,
// a couple of settled stretches.
const spoke: Heard = { ms: 3000, levels: 45, volatiles: 8, finals: 2, peak: 0.6 };

test("a send is a send whatever else the composer looks like", () => {
  expect(classifyHold({ sent: true, keyboardBack: false, heard: spoke })).toBe("sent");
  // The composer clears voice mode on an insert, and a send that raced a mode
  // change must not be read as one.
  expect(classifyHold({ sent: true, keyboardBack: true, heard: spoke })).toBe("sent");
});

test("the keyboard coming back is the Edit zone", () => {
  expect(classifyHold({ sent: false, keyboardBack: true, heard: spoke })).toBe("edit");
});

test("a hold that produced audio and no text was cancelled", () => {
  expect(classifyHold({ sent: false, keyboardBack: false, heard: spoke })).toBe("cancel");
});

test("a cancel is told apart from a bar that did nothing", () => {
  // Same gesture, same duration; the only difference is whether the microphone
  // ever opened. That is the distinction the bench exists to show.
  const heard = { ...NO_HEARD, ms: spoke.ms };
  expect(classifyHold({ sent: false, keyboardBack: false, heard })).toBe("silent");
});

test("a release before the recognizer came up is its own answer", () => {
  const heard = { ...NO_HEARD, ms: TOO_SHORT_MS - 1 };
  expect(classifyHold({ sent: false, keyboardBack: false, heard })).toBe("short");
  // One millisecond later it is a fault, not a fumble.
  const longer = { ...NO_HEARD, ms: TOO_SHORT_MS };
  expect(classifyHold({ sent: false, keyboardBack: false, heard: longer })).toBe("silent");
});

test("a quiet room still counts as audio", () => {
  // Levels are emitted whether or not anyone speaks, so silence during a hold
  // is a cancel with a flat meter, never a fault.
  const silent = { ms: 3000, levels: 45, volatiles: 0, finals: 0, peak: 0 };
  expect(classifyHold({ sent: false, keyboardBack: false, heard: silent })).toBe("cancel");
});

test("the wait for a cancel outlasts the composer's flush", () => {
  // A send delivers no later than FINISH_TIMEOUT_MS after the release. If the
  // bench gave up first it would file every slow send as a cancel.
  expect(RESOLVE_MS).toBeGreaterThan(FINISH_TIMEOUT_MS);
});
