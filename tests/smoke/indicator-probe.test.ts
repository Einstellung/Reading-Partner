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
  PROBE_ENDS_THE_RUN,
  PROBE_REFUSED_THE_HOLD,
  createIndicatorProbe,
  probeRefusedTheHold,
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

// The refusal is read off the flag and never off the stage. Getting this wrong
// is the whole of pitfall 168: `off` is where a probe that has been put away
// sits, putting it away is itself a teardown, and a press that only looked at
// the stage would serve the hold whose engine had just been demolished.
test("the refusal follows the flag, not where the probe was left", () => {
  expect(probeRefusedTheHold({ probeTouched: true })).toBe(true);
  // Every stage, including the one that means the probe was put away.
  for (const stage of INDICATOR_STAGES) {
    expect(probeRefusedTheHold({ probeStage: stage, probeTouched: true })).toBe(true);
    expect(probeRefusedTheHold({ probeStage: stage, probeTouched: false })).toBe(false);
  }
});

test("a hold with no numbers back is not a hold that was refused", () => {
  // The row is made whether or not the timing crossed back in time, and a
  // missing answer must read as "not refused" rather than as a refusal: filing
  // an ordinary fault as a refusal would hide the fault.
  expect(probeRefusedTheHold(null)).toBe(false);
  expect(probeRefusedTheHold(undefined)).toBe(false);
  expect(probeRefusedTheHold({})).toBe(false);
});

// What the person reads. Neither sentence may tell them to put the probe back on
// Off: that is the tap which ends the run, so an instruction to make it is an
// instruction to spoil the next set of numbers.
test("neither sentence sends the person back to the Off button", () => {
  for (const sentence of [PROBE_ENDS_THE_RUN, PROBE_REFUSED_THE_HOLD]) {
    expect(sentence.length).toBeGreaterThan(0);
    expect(sentence).not.toContain("Off");
  }
  expect(PROBE_ENDS_THE_RUN).toContain("refused");
  expect(PROBE_REFUSED_THE_HOLD).toContain("not a run");
});
