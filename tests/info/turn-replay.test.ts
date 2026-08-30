// The table the Swift port is checked against (src/info/companion/turn-replay.ts).
// Nothing here tests the detector — tests/info/turn-detect.test.ts does that.
// What is at stake is the table's provenance: it is a copy of the fixtures, and
// a copy that quietly stops matching what it was copied from would let the two
// machines agree on numbers neither of them was calibrated for.
//
// Run: scripts/t.sh tests/info/turn-replay.test.ts

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REPLAY_SOURCES,
  diffReplay,
  replayFrames,
  turnReplayCases,
  turnReplayCasesJson,
  type ReplayEvent,
  type ReplaySequence,
} from "../../src/info/companion/turn-replay";

const PROBE_DIR = join(import.meta.dir, "../../docs/assets/voice-probe");

/** The same cut tests/info/turn-detect.test.ts makes, made again from source. */
function stageFrames(file: string, stage: string): { atMs: number; db: number }[] {
  const probe = JSON.parse(readFileSync(join(PROBE_DIR, file), "utf8"));
  const span = probe.stages.find((s: { stage: string }) => s.stage === stage);
  if (!span) throw new Error(`no stage ${stage} in ${file}`);
  return probe.events
    .filter(
      (e: { kind: string; sinceStartMs: number }) =>
        e.kind === "level" &&
        e.sinceStartMs >= span.sinceStartMs &&
        e.sinceStartMs < span.endedSinceStartMs,
    )
    .map((e: { sinceStartMs: number; payload: { inputRms: number } }) => ({
      atMs: e.sinceStartMs,
      db:
        e.payload.inputRms > 0
          ? 20 * Math.log10(e.payload.inputRms)
          : Number.NEGATIVE_INFINITY,
    }));
}

test("every sequence is still bit for bit the stage it was cut from", () => {
  const names = Object.keys(REPLAY_SOURCES) as ReplaySequence[];
  expect(names.length).toBe(4);
  for (const name of names) {
    const { file, stage } = REPLAY_SOURCES[name];
    expect(replayFrames(name)).toEqual(stageFrames(file, stage));
  }
});

test("the cases cover every event, both recordings and both stages", () => {
  const cases = turnReplayCases();
  const seen = { duck: 0, stop: 0, resume: 0, end: 0 };
  for (const item of cases) {
    for (const event of item.expected) seen[event.type] += 1;
  }
  expect(seen.duck).toBeGreaterThan(0);
  expect(seen.stop).toBeGreaterThan(0);
  expect(seen.resume).toBeGreaterThan(0);
  expect(seen.end).toBeGreaterThan(0);

  // A case whose right answer is "nothing" proves as much as one with events in
  // it: a port that announced something on the companion's own voice would pass
  // every other case here.
  expect(cases.some((c) => c.expected.length === 0)).toBe(true);

  const frameCounts = new Set(cases.map((c) => c.frames.length));
  expect([...frameCounts].every((n) => n > 0)).toBe(true);
  expect(cases.length).toBe(new Set(cases.map((c) => c.name)).size);
});

// The pin. This is the recorded barge-in at the defaults, and it is the only
// case that produces all four events, so a table that drifted anywhere shows up
// here as a changed list.
test("the recorded barge-in at the defaults is the answer the device has to give", () => {
  const barge = turnReplayCases().find((c) => c.name === "barge-default")!;
  expect(barge.expected).toEqual([
    { atMs: 36278, type: "duck" },
    { atMs: 36694, type: "stop" },
    { atMs: 42074, type: "end", silentMs: 897 },
    { atMs: 42580, type: "duck" },
    { atMs: 42993, type: "stop" },
    { atMs: 43892, type: "end", silentMs: 899 },
    { atMs: 44076, type: "duck" },
    { atMs: 44490, type: "resume" },
  ]);
});

// The harness sends this over a JSON bridge, so anything the format cannot carry
// has to be absent rather than discovered on the phone.
test("the table survives the wire", () => {
  const parsed = JSON.parse(turnReplayCasesJson()) as ReturnType<typeof turnReplayCases>;
  expect(parsed).toEqual(turnReplayCases());
  for (const item of parsed) {
    for (const frame of item.frames) {
      expect(Number.isFinite(frame.db)).toBe(true);
      expect(Number.isFinite(frame.atMs)).toBe(true);
    }
  }
});

test("the comparator says nothing when the streams agree", () => {
  for (const item of turnReplayCases()) {
    expect(diffReplay(item.expected, item.expected)).toEqual([]);
  }
});

test("the comparator names the position and both sides when they do not", () => {
  const expected: ReplayEvent[] = [
    { atMs: 100, type: "duck" },
    { atMs: 400, type: "stop" },
    { atMs: 1200, type: "end", silentMs: 800 },
  ];
  expect(diffReplay(expected, expected.slice(0, 2))).toEqual([
    "length 2, expected 3",
    "#2 missing end@1200 silentMs=800",
  ]);
  expect(
    diffReplay(expected, [
      { atMs: 100, type: "duck" },
      { atMs: 400, type: "resume" },
      { atMs: 1200, type: "end", silentMs: 801 },
    ]),
  ).toEqual([
    "#1 got resume@400, expected stop@400",
    "#2 got end@1200 silentMs=801, expected end@1200 silentMs=800",
  ]);
  expect(diffReplay([], [{ atMs: 5, type: "duck" }])).toEqual([
    "length 1, expected 0",
    "#0 extra duck@5",
  ]);
});
