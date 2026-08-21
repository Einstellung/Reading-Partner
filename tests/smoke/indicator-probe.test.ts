// src/smoke/indicator-probe.ts: the wire contract of the indicator probe.
//
// One command string, one argument key, five stage names, and a returned shape —
// none of it compared by any compiler against the Swift selector, the Rust
// command name or the Swift enum it has to match. The same reasoning as
// dictation-native.test.ts: under bun the plugin does not exist, so a typo here
// is a device build to find out.
//
// Run: bun test tests/smoke/indicator-probe.test.ts

import { expect, test } from "bun:test";
import {
  INDICATOR_PROBE_COMMAND,
  INDICATOR_STAGES,
  INDICATOR_STAGE_OPTIONS,
  createIndicatorProbe,
  type IndicatorProbeState,
} from "../../src/smoke/indicator-probe";

const answer: IndicatorProbeState = {
  stage: "tap",
  sessionActive: true,
  engineRunning: true,
  tapInstalled: true,
  buffers: 7,
  level: 0.02,
  inputs: "MicrophoneBuiltIn",
};

function calls() {
  const seen: { command: string; args?: Record<string, unknown> }[] = [];
  const probe = createIndicatorProbe(async <T,>(command: string, args?: Record<string, unknown>) => {
    seen.push({ command, args });
    return answer as T;
  });
  return { probe, seen };
}

test("a stage goes out under exactly the key the native side decodes", async () => {
  const { probe, seen } = calls();
  await probe("tap");
  expect(seen).toEqual([{ command: "plugin:voice|set_indicator_probe", args: { stage: "tap" } }]);
  expect(INDICATOR_PROBE_COMMAND).toBe("plugin:voice|set_indicator_probe");
});

test("the answer comes back as the state the probe reached", async () => {
  const { probe } = calls();
  expect(await probe("tap")).toEqual(answer);
});

// Four steps and the way back down. The names are matched against a Swift enum
// by raw value; an unknown one is refused there rather than rounded to a stage,
// so a spelling that drifts is a probe that cannot be entered at all.
test("the stages are the four steps plus off, in the order they are entered", () => {
  expect([...INDICATOR_STAGES]).toEqual(["off", "session", "engine", "tap", "recording"]);
  expect(INDICATOR_STAGE_OPTIONS.map((o) => o.value)).toEqual([...INDICATOR_STAGES]);
  for (const option of INDICATOR_STAGE_OPTIONS) {
    expect(option.note.length).toBeGreaterThan(0);
  }
});
