// Voice chat at the door (src/ui/components/companion/door-voice.ts, docs/68).
// Run: scripts/t.sh tests/ui/components/companion/door-voice.test.ts

import { expect, test } from "bun:test";

import {
  arrivedItem,
  carriesCard,
  voiceEntry,
  voiceOffLine,
  voicePhaseLine,
} from "../../../../src/ui/components/companion/door-voice";

test("the button is ready wherever the host speaks, whatever the screen", () => {
  expect(voiceEntry(true)).toEqual({ kind: "ready" });
  expect(voiceEntry(false)).toEqual({ kind: "off", reason: "no-device" });
});

test("a greyed button says why in one line", () => {
  expect(voiceOffLine("no-device")).toBe("shell.door.voiceNoDevice");
});

test("the voice bar reads the call's phase, and the start as listening", () => {
  expect(voicePhaseLine("idle")).toBe("shell.door.voiceListening");
  expect(voicePhaseLine("listening")).toBe("shell.door.voiceListening");
  expect(voicePhaseLine("thinking")).toBe("shell.door.voiceThinking");
  expect(voicePhaseLine("speaking")).toBe("shell.door.voiceSpeaking");
});

test("a box item not seen before is an arrival", () => {
  const seen = new Set(["a", "b"]);
  expect(arrivedItem(seen, [{ id: "a" }, { id: "b" }])).toBeNull();
  expect(arrivedItem(seen, [{ id: "a" }, { id: "c" }])).toEqual({ id: "c" });
  expect(arrivedItem(seen, [])).toBeNull();
});

test("only a message with a card part wants the panel", () => {
  expect(carriesCard({})).toBe(false);
  expect(carriesCard({ parts: [{ type: "text" }] })).toBe(false);
  expect(carriesCard({ parts: [{ type: "text" }, { type: "card" }] })).toBe(true);
});
