// Where a call from the corner is held (src/ui/components/companion/voice-call-mode.ts, docs/68).
// Run: scripts/t.sh tests/ui/components/companion/voice-call-mode.test.ts

import { expect, test } from "bun:test";

import type { Briefing } from "../../../../src/info/boxes/types";
import { voiceCallMode } from "../../../../src/ui/components/companion/voice-call-mode";

const door = { date: "2026-10-20", inReader: true };

test("a screen that published a day holds the call on its briefing", () => {
  const briefing = { mustRead: [], items: {} } as unknown as Briefing;
  expect(voiceCallMode({ dateKey: "2026-10-19", briefing }, door)).toEqual({
    kind: "briefing",
    dateKey: "2026-10-19",
    briefing,
  });
  expect(voiceCallMode({ dateKey: "2026-10-19", briefing: null }, door)).toEqual({
    kind: "briefing",
    dateKey: "2026-10-19",
    briefing: null,
  });
});

test("with nothing published the call is held at the door, on the day it starts", () => {
  expect(voiceCallMode(null, door)).toEqual({ kind: "door", date: "2026-10-20", inReader: true });
  expect(voiceCallMode(null, { date: "2026-10-21", inReader: false })).toEqual({
    kind: "door",
    date: "2026-10-21",
    inReader: false,
  });
});
