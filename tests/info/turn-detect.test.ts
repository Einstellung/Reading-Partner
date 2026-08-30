// The full-duplex turn detector (src/info/companion/turn-detect.ts) run against
// the recorded on-device probe, so the thresholds are answerable from data and
// not from taste. Pure: no React, no audio, no clock. Run: scripts/t.sh
// tests/info/turn-detect.test.ts
//
// The fixtures are one probe session each, VPIO (Apple's voice processing, i.e.
// echo cancellation) on and off. The phone played a fixed 15 s clip at full
// volume with the mic open — the `echo` stage, where a `start` is a false
// barge-in on the companion's own voice — and then a person talked over it —
// the `barge` stage, where a `start` is the whole point. Levels arrive as
// linear RMS per buffer with a millisecond stamp; dBFS is 20*log10 of it.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_TURN_DETECT,
  createTurnDetector,
  initialTurnDetectState,
  resolveTurnDetectConfig,
  stepTurnDetect,
  type TurnDetectConfig,
  type TurnEvent,
} from "../../src/info/companion/turn-detect";

const PROBE_DIR = join(import.meta.dir, "../../docs/assets/voice-probe");
const VPIO_ON = "voice-probe-aec-vpio-on.json";
const VPIO_OFF = "voice-probe-aec-vpio-off.json";

interface Frame {
  atMs: number;
  db: number;
}

/** Every level buffer the probe recorded inside one stage, in order. */
function stageFrames(file: string, stage: string): Frame[] {
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

/** Every event the detector announces over a run of frames, stamped. */
function feed(
  frames: Frame[],
  patch?: Partial<TurnDetectConfig>,
): { atMs: number; event: TurnEvent }[] {
  const detector = createTurnDetector(patch);
  const out: { atMs: number; event: TurnEvent }[] = [];
  for (const f of frames) {
    const event = detector.step(f.db, f.atMs);
    if (event) out.push({ atMs: f.atMs, event });
  }
  return out;
}

const starts = <T extends { event: TurnEvent }>(log: T[]) =>
  log.filter((e) => e.event.type === "start");
const ends = <T extends { event: TurnEvent }>(log: T[]) =>
  log.filter((e) => e.event.type === "end");

function nearestRank(sorted: number[], p: number): number {
  return sorted[Math.max(1, Math.ceil((p / 100) * sorted.length)) - 1];
}

// The numbers every threshold below is argued from. If a fixture is ever
// re-exported and these move, the thresholds have to be re-argued, so they are
// asserted rather than trusted.
test("the probe's echo and barge stages are the levels the defaults were picked from", () => {
  const echo = stageFrames(VPIO_ON, "echo").map((f) => f.db);
  const barge = stageFrames(VPIO_ON, "barge").map((f) => f.db);
  expect(echo.length).toBe(99);
  expect(barge.length).toBe(104);

  const echoSorted = [...echo].sort((a, b) => a - b);
  const bargeSorted = [...barge].sort((a, b) => a - b);
  expect(nearestRank(echoSorted, 90)).toBeCloseTo(-74.2, 1);
  expect(echoSorted[echoSorted.length - 1]).toBeCloseTo(-38.5, 1);
  expect(nearestRank(bargeSorted, 90)).toBeCloseTo(-19.1, 1);
  expect(bargeSorted[bargeSorted.length - 1]).toBeCloseTo(-12.5, 1);

  // The margin the -35 default sits in: 3.5 dB above the loudest echo frame,
  // 16 dB below the barge p90.
  expect(DEFAULT_TURN_DETECT.startDb).toBeGreaterThan(echoSorted[echoSorted.length - 1]);
  expect(DEFAULT_TURN_DETECT.startDb).toBeLessThan(nearestRank(bargeSorted, 90));
});

// 1.
test("with VPIO on, 15 s of the companion's own voice opens no turn", () => {
  const log = feed(stageFrames(VPIO_ON, "echo"));
  expect(log).toEqual([]);
});

// 2. The barge-in is one turn only if the hangover outlasts the pauses inside
// it; see the default-hangover test below for what 800 ms does to this take.
test("the barge-in opens exactly one turn, at the buffer the person crosses the line", () => {
  const log = feed(stageFrames(VPIO_ON, "barge"), { hangoverMs: 1500 });
  expect(starts(log).map((e) => e.atMs)).toEqual([36278]);
});

// 3. The stage's own trailing silence closes the turn: the last loud buffer is
// at 44190, the hangover is 1500, and the first buffer at or past that is 45777.
test("the turn closes one hangover after the last loud buffer, with the gap it measured", () => {
  const log = feed(stageFrames(VPIO_ON, "barge"), { hangoverMs: 1500 });
  expect(ends(log)).toEqual([{ atMs: 45777, event: { type: "end", silentMs: 1587 } }]);
});

test("silentMs is the measured gap, not the configured one", () => {
  // Buffers every 200 ms, so a 700 ms hangover is announced on the first buffer
  // past it: 800 ms of real silence, not 700.
  const detector = createTurnDetector({ hangoverMs: 700 });
  expect(detector.step(-10, 0)).toEqual({ type: "start" });
  const seen: TurnEvent[] = [];
  for (let t = 200; t <= 1200; t += 200) {
    const e = detector.step(Number.NEGATIVE_INFINITY, t);
    if (e) seen.push(e);
  }
  expect(seen).toEqual([{ type: "end", silentMs: 800 }]);
});

// 4. What the second frame buys: the echo tail crosses -50 dBFS in isolated
// single buffers only, so requiring two consecutive ones moves the usable
// threshold 15 dB down without letting the echo through.
test("two consecutive frames hold the echo out at -50 dBFS, where one frame does not", () => {
  const echo = stageFrames(VPIO_ON, "echo");
  expect(starts(feed(echo, { startDb: -50, startFrames: 2 }))).toEqual([]);
  expect(starts(feed(echo, { startDb: -50, startFrames: 1 })).length).toBe(3);
  // The headroom runs out at -55: two consecutive buffers of echo do occur there.
  expect(starts(feed(echo, { startDb: -55, startFrames: 2 })).length).toBe(1);
  // And the barge-in still opens a turn at the loosened threshold.
  expect(starts(feed(stageFrames(VPIO_ON, "barge"), { startDb: -50, startFrames: 2 })).length)
    .toBeGreaterThan(0);
});

// 5. The whole scale is a property of the input chain, not of speech. With
// voice processing off there is no AGC either, everything lands ~20 dB lower,
// and the defaults stop working in both directions at once.
test("the calibration does not survive VPIO being off", () => {
  const echo = stageFrames(VPIO_OFF, "echo");
  const barge = stageFrames(VPIO_OFF, "barge");

  // The person really did talk, and the default threshold never notices.
  expect(starts(feed(barge))).toEqual([]);

  // Dropping the threshold far enough to hear them lets the companion's own
  // voice open turns too, and the second frame does not save it.
  expect(starts(feed(barge, { startDb: -60 })).length).toBe(1);
  expect(starts(feed(echo, { startDb: -60 })).length).toBe(2);
  expect(starts(feed(echo, { startDb: -60, startFrames: 2 })).length).toBe(2);
});

// 6. Cutting the playback takes the AEC reference with it, so the residue can
// rebound for a buffer or two. With the defaults this window can never bind —
// a second `start` needs an `end` first, and that needs 800 ms of silence — so
// it is insurance for short hangovers, and it is tested at one.
test("the refractory window swallows a rebound right after a start", () => {
  const config = { hangoverMs: 100, refractoryMs: 300 };
  const detector = createTurnDetector(config);
  expect(detector.step(-10, 0)).toEqual({ type: "start" });
  expect(detector.step(Number.NEGATIVE_INFINITY, 150)).toEqual({ type: "end", silentMs: 150 });
  // The rebound: loud again 200 ms after the start, inside the window.
  expect(detector.step(-10, 200)).toBeNull();
  expect(detector.step(-10, 250)).toBeNull();
  // Past the window, still loud, the turn opens on the first buffer.
  expect(detector.step(-10, 320)).toEqual({ type: "start" });

  // Same input with the window off is the second start it was suppressing.
  const open = createTurnDetector({ ...config, refractoryMs: 0 });
  open.step(-10, 0);
  open.step(Number.NEGATIVE_INFINITY, 150);
  expect(open.step(-10, 200)).toEqual({ type: "start" });
});

test("a turn cannot end before it starts", () => {
  const detector = createTurnDetector();
  for (let t = 0; t <= 5000; t += 200) {
    expect(detector.step(-90, t)).toBeNull();
  }
  expect(detector.snapshot().speaking).toBe(false);
});

test("staying loud does not re-announce the start", () => {
  const detector = createTurnDetector();
  expect(detector.step(-10, 0)).toEqual({ type: "start" });
  for (let t = 150; t <= 3000; t += 150) {
    expect(detector.step(-10, t)).toBeNull();
  }
});

// 7. Edges.
test("no frames at all is no events and no state", () => {
  const detector = createTurnDetector();
  expect(detector.snapshot()).toEqual(initialTurnDetectState());
  expect(feed([])).toEqual([]);
});

test("one frame is enough to start and never enough to end", () => {
  expect(feed([{ atMs: 12345, db: -20 }])).toEqual([
    { atMs: 12345, event: { type: "start" } },
  ]);
  expect(feed([{ atMs: 12345, db: -90 }])).toEqual([]);
});

test("digital silence is quiet, not an exception", () => {
  const detector = createTurnDetector();
  expect(detector.step(Number.NEGATIVE_INFINITY, 0)).toBeNull();
  expect(detector.step(-10, 100)).toEqual({ type: "start" });
  expect(detector.step(Number.NEGATIVE_INFINITY, 200)).toBeNull();
  expect(detector.step(Number.NEGATIVE_INFINITY, 1000)).toEqual({
    type: "end",
    silentMs: 900,
  });
  expect(Number.isFinite(detector.snapshot().lastVoiceMs)).toBe(true);
});

test("a stalled tap is measured in wall clock, not in buffers", () => {
  const detector = createTurnDetector();
  expect(detector.step(-10, 1000)).toEqual({ type: "start" });
  // One buffer, 60 s later. A frame counter would still be waiting.
  expect(detector.step(-90, 61000)).toEqual({ type: "end", silentMs: 60000 });
});

test("a loud buffer after a delivery gap extends the turn instead of splitting it", () => {
  const detector = createTurnDetector();
  expect(detector.step(-10, 0)).toEqual({ type: "start" });
  expect(detector.step(-10, 5000)).toBeNull();
  expect(detector.snapshot().speaking).toBe(true);
});

test("the threshold is inclusive at the line", () => {
  expect(createTurnDetector({ startDb: -35 }).step(-35, 0)).toEqual({ type: "start" });
  expect(createTurnDetector({ startDb: -35 }).step(-35.0001, 0)).toBeNull();
});

test("the config is all defaults, all overridable, and clamped where it can be wrong", () => {
  expect(resolveTurnDetectConfig()).toEqual(DEFAULT_TURN_DETECT);
  expect(resolveTurnDetectConfig({ startDb: -42 })).toEqual({
    ...DEFAULT_TURN_DETECT,
    startDb: -42,
  });
  expect(resolveTurnDetectConfig({ startFrames: 0, hangoverMs: -1, refractoryMs: -1 })).toEqual({
    startDb: -35,
    startFrames: 1,
    hangoverMs: 0,
    refractoryMs: 0,
  });
  expect(DEFAULT_TURN_DETECT).toEqual({
    startDb: -35,
    startFrames: 1,
    hangoverMs: 800,
    refractoryMs: 300,
  });
});

test("the step function does not touch the state it was handed", () => {
  const config = resolveTurnDetectConfig();
  const state = initialTurnDetectState();
  const a = stepTurnDetect(state, config, -10, 0);
  const b = stepTurnDetect(state, config, -10, 0);
  expect(state).toEqual(initialTurnDetectState());
  expect(a).toEqual(b);
});

test("reset puts the machine back to silence without announcing anything", () => {
  const detector = createTurnDetector();
  detector.step(-10, 0);
  expect(detector.snapshot().speaking).toBe(true);
  detector.reset();
  expect(detector.snapshot()).toEqual(initialTurnDetectState());
  // No refractory memory survives a reset: the next loud buffer opens a turn.
  expect(detector.step(-10, 50)).toEqual({ type: "start" });
});

// Kept as evidence, not as an endorsement: on this recording the person paused
// 1.4 s and 1.1 s mid-sentence, and the 800 ms default takes the turn away from
// them twice.
test("the default hangover splits this real barge-in into three turns", () => {
  const log = feed(stageFrames(VPIO_ON, "barge"));
  expect(log).toEqual([
    { atMs: 36278, event: { type: "start" } },
    { atMs: 42074, event: { type: "end", silentMs: 897 } },
    { atMs: 42580, event: { type: "start" } },
    { atMs: 43892, event: { type: "end", silentMs: 899 } },
    { atMs: 44076, event: { type: "start" } },
    { atMs: 44994, event: { type: "end", silentMs: 804 } },
  ]);
});
