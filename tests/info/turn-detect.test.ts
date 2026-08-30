// The full-duplex turn detector (src/info/companion/turn-detect.ts) run against
// the recorded on-device probe, so the thresholds are answerable from data and
// not from taste. Pure: no React, no audio, no clock. Run: scripts/t.sh
// tests/info/turn-detect.test.ts
//
// The fixtures are one probe session each, VPIO (Apple's voice processing, i.e.
// echo cancellation) on and off. The phone played a fixed 15 s clip at full
// volume with the mic open — the `echo` stage, where a `duck` is a false
// barge-in on the companion's own voice — and then a person talked over it —
// the `barge` stage, where a `duck` is the whole point. Levels arrive as
// linear RMS per buffer with a millisecond stamp; dBFS is 20*log10 of it.
//
// Crossing the line ducks the playback; only voice that survives `confirmMs`
// escalates to `stop`. So there are two questions per fixture now, and they get
// asked separately: did it duck, and did the duck turn out to be real.

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

const only =
  (type: TurnEvent["type"]) =>
  <T extends { event: TurnEvent }>(log: T[]) =>
    log.filter((e) => e.event.type === type);
const ducks = only("duck");
const stops = only("stop");
const resumes = only("resume");
const ends = only("end");

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

// The delivery timing the two millisecond windows are sized against. confirmMs
// has to outlast one buffer so confirming needs a later delivery than the duck;
// resumeMs has to outlast one buffer so a dropped delivery cannot un-duck.
test("the tap's delivery interval is what the millisecond windows are sized against", () => {
  const barge = stageFrames(VPIO_ON, "barge");
  const gaps = barge.slice(1).map((f, i) => f.atMs - barge[i].atMs);
  expect(Math.min(...gaps)).toBe(113);
  expect(Math.max(...gaps)).toBe(208);
  expect(DEFAULT_TURN_DETECT.confirmMs).toBeGreaterThan(Math.max(...gaps));
  expect(DEFAULT_TURN_DETECT.resumeMs).toBeGreaterThan(Math.max(...gaps));
});

// 1.
test("with VPIO on, 15 s of the companion's own voice never even ducks", () => {
  const log = feed(stageFrames(VPIO_ON, "echo"));
  expect(log).toEqual([]);
});

// 2. The barge-in is one turn only if the hangover outlasts the pauses inside
// it; the default does, see the hangover table below for what it costs.
test("the barge-in ducks once and escalates to a stop, at the buffer the person crosses", () => {
  const log = feed(stageFrames(VPIO_ON, "barge"));
  expect(ducks(log).map((e) => e.atMs)).toEqual([36278]);
  expect(stops(log).map((e) => e.atMs)).toEqual([36694]);
  expect(resumes(log)).toEqual([]);
  // The escalation waited out the confirm window and no longer.
  expect(36694 - 36278).toBeGreaterThanOrEqual(DEFAULT_TURN_DETECT.confirmMs);
});

// 3. The stage's own trailing silence closes the turn: the last loud buffer is
// at 44190, the hangover is 1250, and the first buffer at or past that is 45478
// — which measured 1288 ms, not 1250, because the buffer that would have
// measured 1250 exactly does not exist.
test("the turn closes one hangover after the last loud buffer, with the gap it measured", () => {
  const log = feed(stageFrames(VPIO_ON, "barge"));
  expect(ends(log)).toEqual([{ atMs: 45478, event: { type: "end", silentMs: 1288 } }]);
});

test("silentMs is the measured gap, not the configured one", () => {
  // Buffers every 200 ms, so a 700 ms hangover is announced on the first buffer
  // past it: 800 ms of real silence, not 700.
  const detector = createTurnDetector({ hangoverMs: 700 });
  expect(detector.step(-10, 0)).toEqual({ type: "duck" });
  expect(detector.step(-10, 200)).toBeNull();
  expect(detector.step(-10, 400)).toEqual({ type: "stop" });
  const seen: TurnEvent[] = [];
  for (let t = 600; t <= 1600; t += 200) {
    const e = detector.step(Number.NEGATIVE_INFINITY, t);
    if (e) seen.push(e);
  }
  expect(seen).toEqual([{ type: "end", silentMs: 800 }]);
});

// 4. What ducking bought, measured on the fixture that used to fail. At -50
// dBFS with one frame the echo tail crosses three times — the old machine cut
// the playback three times, this one ducks three times and stops zero times,
// because none of the crossings is still there a confirm window later.
test("at a threshold the echo crosses, the confirm window turns every cut into a wobble", () => {
  const echo = stageFrames(VPIO_ON, "echo");
  const loose = feed(echo, { startDb: -50 });
  expect(ducks(loose).map((e) => e.atMs)).toEqual([18593, 19582, 23789]);
  expect(stops(loose)).toEqual([]);
  expect(resumes(loose).length).toBe(3);
});

// 5. What the second frame still buys on top of that: the echo tail crosses
// -50 dBFS in isolated single buffers only, so requiring two consecutive ones
// moves the usable threshold 15 dB down without the echo ever ducking at all.
test("two consecutive frames hold the echo out at -50 dBFS, where one frame does not", () => {
  const echo = stageFrames(VPIO_ON, "echo");
  expect(feed(echo, { startDb: -50, startFrames: 2 })).toEqual([]);
  expect(ducks(feed(echo, { startDb: -50, startFrames: 1 })).length).toBe(3);
  // The headroom runs out at -55: two consecutive buffers of echo do occur
  // there, and the playback ducks. It still never stops.
  const tooLow = feed(echo, { startDb: -55, startFrames: 2 });
  expect(ducks(tooLow).length).toBe(1);
  expect(stops(tooLow)).toEqual([]);
  // And the barge-in still takes the turn at the loosened threshold.
  expect(stops(feed(stageFrames(VPIO_ON, "barge"), { startDb: -50, startFrames: 2 })).length)
    .toBeGreaterThan(0);
});

// 6. The whole scale is a property of the input chain, not of speech. With
// voice processing off there is no AGC either, everything lands ~20 dB lower,
// and the defaults stop working in both directions at once. This is the control
// group: it says the calibration is only valid with VPIO on, and ducking does
// not rescue it — at the default the machine is deaf, and at a threshold that
// hears the person the companion's own voice reaches `stop`, not just `duck`.
test("the calibration does not survive VPIO being off", () => {
  const echo = stageFrames(VPIO_OFF, "echo");
  const barge = stageFrames(VPIO_OFF, "barge");

  // The person really did talk, and the default threshold never notices —
  // the loudest frame of that barge-in is 0.46 dB short of the line.
  expect(feed(barge)).toEqual([]);
  expect(Math.max(...barge.map((f) => f.db))).toBeCloseTo(-35.46, 1);

  // Dropping the threshold far enough to hear them lets the companion's own
  // voice take the turn outright, and the second frame does not save it.
  expect(stops(feed(barge, { startDb: -60 })).length).toBe(1);
  expect(stops(feed(echo, { startDb: -60 })).length).toBe(2);
  expect(stops(feed(echo, { startDb: -60, startFrames: 2 })).length).toBe(2);
});

// 7. The false alarm this whole redesign exists to make cheap: one buffer over
// the line and then nothing. It ducks, it never stops, and it puts the volume
// back.
test("a single-frame spike ducks and resumes without ever stopping the playback", () => {
  const detector = createTurnDetector();
  expect(detector.step(-10, 0)).toEqual({ type: "duck" });
  // Buffers keep arriving, all quiet. Not yet resumeMs of silence.
  expect(detector.step(-90, 180)).toBeNull();
  expect(detector.step(Number.NEGATIVE_INFINITY, 360)).toEqual({ type: "resume" });
  // Nothing further, and in particular no `stop` and no `end`.
  const after: TurnEvent[] = [];
  for (let t = 5000; t <= 9000; t += 180) {
    const e = detector.step(-90, t);
    if (e) after.push(e);
  }
  expect(after).toEqual([]);
});

test("a resume puts the machine back where a real onset ducks again", () => {
  const detector = createTurnDetector();
  expect(detector.step(-10, 0)).toEqual({ type: "duck" });
  expect(detector.step(-90, 360)).toEqual({ type: "resume" });
  expect(detector.snapshot().phase).toBe("idle");
  // Past the resume guard, the next real onset is treated as a first onset.
  expect(detector.step(-10, 700)).toEqual({ type: "duck" });
  expect(detector.step(-10, 1000)).toEqual({ type: "stop" });
  expect(detector.step(Number.NEGATIVE_INFINITY, 2300)).toEqual({
    type: "end",
    silentMs: 1300,
  });
});

// 8. The guard the old refractory window became. A resume ramps the volume back
// up; a source sitting on the threshold would otherwise duck and resume at the
// buffer rate, and the playback flutters. Guarding after the resume is where
// this belongs now — nothing is torn down at the duck, so there is no cut for a
// rebound to follow.
test("the resume guard keeps a marginal source from fluttering the volume", () => {
  const detector = createTurnDetector();
  expect(detector.step(-10, 0)).toEqual({ type: "duck" });
  expect(detector.step(-90, 360)).toEqual({ type: "resume" });
  // Loud again 115 ms after the resume, inside the guard.
  expect(detector.step(-10, 475)).toBeNull();
  expect(detector.step(-10, 600)).toBeNull();
  // Past the guard, still loud, it ducks on the first buffer.
  expect(detector.step(-10, 680)).toEqual({ type: "duck" });

  // Same input with the guard off is the duck it was suppressing.
  const open = createTurnDetector({ resumeGuardMs: 0 });
  open.step(-10, 0);
  open.step(-90, 360);
  expect(open.step(-10, 475)).toEqual({ type: "duck" });
});

// And the same thing on real audio: at a threshold where the echo crosses, the
// probe's own tail produces two crossings 115 ms apart, which is one ramp pair
// with the guard and two without.
test("the resume guard collapses a real burst of echo crossings into one wobble", () => {
  const echo = stageFrames(VPIO_ON, "echo");
  expect(ducks(feed(echo, { startDb: -45 })).map((e) => e.atMs)).toEqual([18593, 23789]);
  expect(ducks(feed(echo, { startDb: -45, resumeGuardMs: 0 })).map((e) => e.atMs)).toEqual([
    18593, 23789, 24295,
  ]);
  // 24295 is 115 ms after the resume that 23789's duck produced.
  expect(resumes(feed(echo, { startDb: -45 })).map((e) => e.atMs)).toEqual([19074, 24180]);
});

test("a turn cannot end before it starts", () => {
  const detector = createTurnDetector();
  for (let t = 0; t <= 5000; t += 200) {
    expect(detector.step(-90, t)).toBeNull();
  }
  expect(detector.snapshot().phase).toBe("idle");
});

test("staying loud announces the duck and the stop once each and nothing after", () => {
  const detector = createTurnDetector();
  expect(detector.step(-10, 0)).toEqual({ type: "duck" });
  expect(detector.step(-10, 150)).toBeNull();
  expect(detector.step(-10, 300)).toEqual({ type: "stop" });
  for (let t = 450; t <= 3000; t += 150) {
    expect(detector.step(-10, t)).toBeNull();
  }
});

// 9. Edges.
test("no frames at all is no events and no state", () => {
  const detector = createTurnDetector();
  expect(detector.snapshot()).toEqual(initialTurnDetectState());
  expect(feed([])).toEqual([]);
});

test("one frame is enough to duck and never enough to stop", () => {
  expect(feed([{ atMs: 12345, db: -20 }])).toEqual([
    { atMs: 12345, event: { type: "duck" } },
  ]);
  expect(feed([{ atMs: 12345, db: -90 }])).toEqual([]);
});

test("digital silence is quiet, not an exception", () => {
  const detector = createTurnDetector();
  expect(detector.step(Number.NEGATIVE_INFINITY, 0)).toBeNull();
  expect(detector.step(-10, 100)).toEqual({ type: "duck" });
  expect(detector.step(-10, 400)).toEqual({ type: "stop" });
  expect(detector.step(Number.NEGATIVE_INFINITY, 500)).toBeNull();
  expect(detector.step(Number.NEGATIVE_INFINITY, 1650)).toEqual({
    type: "end",
    silentMs: 1250,
  });
  expect(Number.isFinite(detector.snapshot().lastVoiceMs)).toBe(true);
});

test("a stalled tap is measured in wall clock, not in buffers", () => {
  const detector = createTurnDetector();
  expect(detector.step(-10, 1000)).toEqual({ type: "duck" });
  expect(detector.step(-10, 1400)).toEqual({ type: "stop" });
  // One buffer, 60 s later. A frame counter would still be waiting.
  expect(detector.step(-90, 61400)).toEqual({ type: "end", silentMs: 60000 });
});

test("a stalled tap resumes a stale duck instead of leaving the volume down", () => {
  const detector = createTurnDetector();
  expect(detector.step(-10, 0)).toEqual({ type: "duck" });
  // The caller drives time with no audio; the duck does not survive it.
  expect(detector.step(Number.NEGATIVE_INFINITY, 30000)).toEqual({ type: "resume" });
});

test("a loud buffer after a delivery gap extends the turn instead of splitting it", () => {
  const detector = createTurnDetector();
  expect(detector.step(-10, 0)).toEqual({ type: "duck" });
  expect(detector.step(-10, 400)).toEqual({ type: "stop" });
  expect(detector.step(-10, 5400)).toBeNull();
  expect(detector.snapshot().phase).toBe("speaking");
});

test("the threshold is inclusive at the line", () => {
  expect(createTurnDetector({ startDb: -35 }).step(-35, 0)).toEqual({ type: "duck" });
  expect(createTurnDetector({ startDb: -35 }).step(-35.0001, 0)).toBeNull();
});

test("the config is all defaults, all overridable, and clamped where it can be wrong", () => {
  expect(resolveTurnDetectConfig()).toEqual(DEFAULT_TURN_DETECT);
  expect(resolveTurnDetectConfig({ startDb: -42 })).toEqual({
    ...DEFAULT_TURN_DETECT,
    startDb: -42,
  });
  expect(
    resolveTurnDetectConfig({
      startFrames: 0,
      confirmMs: -1,
      resumeMs: -1,
      hangoverMs: -1,
      resumeGuardMs: -1,
    }),
  ).toEqual({
    startDb: -35,
    startFrames: 1,
    confirmMs: 0,
    resumeMs: 0,
    hangoverMs: 0,
    resumeGuardMs: 0,
  });
  expect(DEFAULT_TURN_DETECT).toEqual({
    startDb: -35,
    startFrames: 1,
    confirmMs: 300,
    resumeMs: 300,
    hangoverMs: 1250,
    resumeGuardMs: 300,
  });
});

// Even with the window off, confirming still costs one delivery, so a lone
// buffer can never reach `stop` and every step announces at most one event.
test("confirmMs at zero still takes a second buffer to stop", () => {
  const detector = createTurnDetector({ confirmMs: 0 });
  expect(detector.step(-10, 0)).toEqual({ type: "duck" });
  expect(detector.step(-10, 1)).toEqual({ type: "stop" });
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
  expect(detector.snapshot().phase).toBe("ducked");
  detector.reset();
  expect(detector.snapshot()).toEqual(initialTurnDetectState());
  // No resume-guard memory survives a reset: the next loud buffer ducks.
  expect(detector.step(-10, 50)).toEqual({ type: "duck" });
});

// The grammar the caller may rely on when it wires these to a volume ramp:
// duck before stop, stop before end, and a resumed duck never turns into a
// stop afterwards. Checked over both fixtures, both stages, and a grid of
// configs including degenerate ones.
test("the event sequence is always duck -> (resume | stop -> end)", () => {
  const grids: Partial<TurnDetectConfig>[] = [];
  for (const startDb of [-35, -50, -60]) {
    for (const startFrames of [1, 2]) {
      for (const confirmMs of [0, 300, 1200]) {
        for (const resumeMs of [0, 300, 1500]) {
          for (const hangoverMs of [0, 1250, 2000]) {
            grids.push({ startDb, startFrames, confirmMs, resumeMs, hangoverMs });
          }
        }
      }
    }
  }
  const sawEveryEvent = { duck: 0, stop: 0, resume: 0, end: 0 };
  for (const file of [VPIO_ON, VPIO_OFF]) {
    for (const stage of ["echo", "barge"]) {
      const frames = stageFrames(file, stage);
      for (const patch of grids) {
        let phase = "idle";
        for (const { event } of feed(frames, patch)) {
          sawEveryEvent[event.type]++;
          if (event.type === "duck") {
            expect(phase).toBe("idle");
            phase = "ducked";
          } else if (event.type === "stop") {
            expect(phase).toBe("ducked");
            phase = "speaking";
          } else if (event.type === "resume") {
            expect(phase).toBe("ducked");
            phase = "idle";
          } else {
            expect(phase).toBe("speaking");
            phase = "idle";
          }
        }
      }
    }
  }
  // The grid is only worth anything if it actually produced all four.
  expect(sawEveryEvent.duck).toBeGreaterThan(0);
  expect(sawEveryEvent.stop).toBeGreaterThan(0);
  expect(sawEveryEvent.resume).toBeGreaterThan(0);
  expect(sawEveryEvent.end).toBeGreaterThan(0);
});

// The whole recording at the shipped defaults, which is what the person paused
// 1.4 s and 1.1 s in the middle of: one duck, one stop, one end. The two
// mid-sentence pauses no longer take the turn away from them, and the two
// trailing fragments that used to be a second turn and a false alarm are inside
// this turn instead of after it.
test("the default hangover holds this real barge-in together as one turn", () => {
  const log = feed(stageFrames(VPIO_ON, "barge"));
  expect(log).toEqual([
    { atMs: 36278, event: { type: "duck" } },
    { atMs: 36694, event: { type: "stop" } },
    { atMs: 45478, event: { type: "end", silentMs: 1288 } },
  ]);
});

// What the previous default did to the same recording, kept because 1250 is
// only defensible next to it: two turns, so the companion answered in the
// middle of the person's sentence, and one false alarm after it.
test("the 800 ms this default replaced split that barge-in in two", () => {
  const log = feed(stageFrames(VPIO_ON, "barge"), { hangoverMs: 800 });
  expect(log).toEqual([
    { atMs: 36278, event: { type: "duck" } },
    { atMs: 36694, event: { type: "stop" } },
    { atMs: 42074, event: { type: "end", silentMs: 897 } },
    { atMs: 42580, event: { type: "duck" } },
    { atMs: 42993, event: { type: "stop" } },
    { atMs: 43892, event: { type: "end", silentMs: 899 } },
    // The trailing two buffers are too short to span confirmMs, so the
    // playback wobbles instead of being cut a third time.
    { atMs: 44076, event: { type: "duck" } },
    { atMs: 44490, event: { type: "resume" } },
  ]);
});

// The hangover trade-off, quantified on this one recording so the number can be
// picked rather than guessed. `turns` is how many times the person had the
// companion cut off; `replyLatency` is each `end` minus the last loud buffer
// before it, i.e. how long the companion waited after they stopped. Latency is
// always the hangover plus up to one delivery interval.
//
// The break-even is 1220, not 1500: the 1403 ms pause is only ever *observed*
// as 1219 ms of silence, because the buffer that would have measured more
// arrived loud. What the hangover is compared against is the tap's sampling of
// the pause, not the pause.
test("what the hangover costs on this recording, at the values worth considering", () => {
  const frames = stageFrames(VPIO_ON, "barge");
  const summarise = (hangoverMs: number) => {
    const log = feed(frames, { hangoverMs });
    return {
      turns: stops(log).length,
      falseAlarms: resumes(log).length,
      replyLatency: ends(log).map((e) => {
        const lastLoud = frames.filter((f) => f.db >= -35 && f.atMs < e.atMs).pop()!;
        return e.atMs - lastLoud.atMs;
      }),
    };
  };

  expect(summarise(800)).toEqual({ turns: 2, falseAlarms: 1, replyLatency: [897, 899] });
  expect(summarise(1000)).toEqual({ turns: 2, falseAlarms: 0, replyLatency: [1011, 1103] });
  expect(summarise(1200)).toEqual({ turns: 2, falseAlarms: 0, replyLatency: [1219, 1288] });
  expect(summarise(1250)).toEqual({ turns: 1, falseAlarms: 0, replyLatency: [1288] });
  expect(summarise(1500)).toEqual({ turns: 1, falseAlarms: 0, replyLatency: [1587] });
  expect(summarise(2000)).toEqual({ turns: 1, falseAlarms: 0, replyLatency: [2003] });

  // 1000 and 1200 buy nothing 800 did not: the split survives both.
  expect(summarise(1219).turns).toBe(2);
  expect(summarise(1220).turns).toBe(1);

  // Why the default is 1250 and not 1500: past the break-even the turn ends on
  // the first buffer of the stage's trailing silence either way, and asking for
  // 250 ms more silence than that buffer measured only delays the reply.
  expect(DEFAULT_TURN_DETECT.hangoverMs).toBeGreaterThan(1220);
  expect(summarise(1250).replyLatency).toEqual(summarise(1220).replyLatency);
  expect(summarise(1500).replyLatency[0]).toBeGreaterThan(summarise(1250).replyLatency[0]);

  // At 800 the companion answered 298 ms before the person's actual last word,
  // which is the split stated as a delay rather than as a count. At the default
  // it waits until they have really finished.
  const lastWord = frames.filter((f) => f.db >= -35).pop()!.atMs;
  expect(lastWord).toBe(44190);
  expect(ends(feed(frames, { hangoverMs: 800 })).pop()!.atMs - lastWord).toBe(-298);
  expect(ends(feed(frames)).pop()!.atMs - lastWord).toBe(1288);
});
