// Who is talking, decided from one number per audio buffer (docs/33, docs/45).
// The full-duplex call keeps the mic open while the companion speaks, so two
// edges have to be found in the level stream: the user STARTED (get out of
// their way) and the user STOPPED (take the turn).
//
// Crossing the line does not cut the playback. It ducks it: the volume drops,
// the companion keeps talking under the user, and only sustained voice past
// the crossing escalates to a real stop. That is what the two-stage vocabulary
// below buys — a false trigger costs a wobble in the volume instead of a
// sentence cut in half, so the threshold can sit where it catches real speech
// early rather than where it is safe to cut on.
//
// The whole judgement is a dB threshold plus three timers. That is the first
// version on purpose: zero bytes, zero licence, zero dependency, and the
// on-device probe says the margin is there — with voice processing on, the
// loudest echo frame measured -38.5 dBFS while the user's barge-in sat at
// -19.1 dBFS p90. The insurance is that a real phone disagreeing costs a
// constant, not a redesign, so every number lives in TurnDetectConfig and
// nothing here hard-codes one.
//
// This machine gets transliterated into Swift and run on the audio thread, so
// it stays a struct and a function: no clock, no I/O, no timers, no closures
// over closures. `atMs` is a monotonic wall clock the caller passes in, never
// a frame count times an assumed buffer length — the tap on device delivers at
// 5.5-10 Hz and the same build measured different rates on different runs.

/** What one step can announce. At most one per step. */
export type TurnEvent =
  // Someone crossed the line and it looks like the user. Duck the playback:
  // drop the volume, do not tear anything down. Not yet a turn.
  | { type: "duck" }
  // The voice held past `confirmMs`, so it is the user. Stop the playback for
  // real and hand them the turn.
  //
  // This is also where the caller reads off how much of the companion's reply
  // actually reached the user, for the transcript it keeps and for whatever it
  // tells the model was said. Not at the duck: ducking only lowers the volume,
  // and everything played between the duck and here was still audible. The
  // authoritative moment is the one where the audio truly stopped.
  | { type: "stop" }
  // It went quiet before `confirmMs` was up, so the duck was a false alarm.
  // Put the volume back. The turn never happened; no `stop`, no `end`.
  | { type: "resume" }
  // The user stopped: `silentMs` is the measured gap since their last loud
  // frame, which is >= hangoverMs and can be much larger if the tap stalled.
  // Only ever follows a `stop` — a turn has to be taken before it can end.
  | { type: "end"; silentMs: number };

export interface TurnDetectConfig {
  // A buffer at or above this dBFS counts as voice. Default -35: the most
  // conservative reading the probe supports (loudest echo frame -38.5).
  startDb: number;
  // How many consecutive loud buffers duck the playback. 1 reacts in one
  // buffer (~110-200 ms); 2 costs one buffer of latency and buys threshold
  // headroom, because the echo tail crosses -50 dBFS in single frames only.
  startFrames: number;
  // Voice has to still be there this long after the duck to escalate to
  // `stop`. Default 300: longer than the widest buffer interval the probe
  // measured (208 ms), so confirming always takes a *later* delivery than the
  // one that ducked and no single-buffer artefact can reach `stop`; and well
  // inside the 597 ms first voice run of the recorded barge-in, so a real
  // barge-in confirms without waiting for a second run. The cost is that an
  // utterance too short to span it ducks and resumes without taking the turn.
  confirmMs: number;
  // Silence this long while ducked calls the duck a false alarm. Default 300:
  // above the 117 and 185 ms dips measured *inside* the recorded barge-in's
  // speech, and far below the 802 ms shortest real pause in it, so a dropped
  // buffer or a stop consonant does not un-duck mid-word.
  resumeMs: number;
  // Silence this long after the last loud buffer closes the turn. Default 1250:
  // the recorded barge-in has a 1403 ms pause in the middle of a sentence, and
  // the break-even that keeps it one turn is 1220, not 1403 — the tap only ever
  // *observed* 1219 ms of that pause, because the buffer that would have
  // measured more arrived loud. Silence measured on a sampled stream is always
  // shorter than the pause it samples, and that gap is the entire difference
  // between 1220 and 1500.
  //
  // 800 was the first guess and it costs a turn: it cuts that barge-in in two
  // and starts the reply 298 ms before the person's last word. 1250 clears the
  // break-even by 30 ms and pays for it in reply latency, which is always the
  // hangover plus up to one delivery interval.
  hangoverMs: number;
  // No new duck within this long of a `resume`. A resume ramps the volume back
  // up; without this, a source sitting on the threshold ducks and resumes at
  // the buffer rate and the playback audibly flutters. The probe's own echo
  // stage does this once the threshold is loosened to where the echo crosses
  // at all: at -55 dBFS its isolated crossings land 323 and 481 ms apart.
  resumeGuardMs: number;
}

export const DEFAULT_TURN_DETECT: TurnDetectConfig = {
  startDb: -35,
  startFrames: 1,
  confirmMs: 300,
  resumeMs: 300,
  hangoverMs: 1250,
  resumeGuardMs: 300,
};

/**
 * Fill in the defaults and clamp the values a caller can get wrong. Fewer than
 * one frame is one frame; negative durations are zero.
 */
export function resolveTurnDetectConfig(patch?: Partial<TurnDetectConfig>): TurnDetectConfig {
  const c = { ...DEFAULT_TURN_DETECT, ...patch };
  return {
    startDb: c.startDb,
    startFrames: Math.max(1, Math.floor(c.startFrames)),
    confirmMs: Math.max(0, c.confirmMs),
    resumeMs: Math.max(0, c.resumeMs),
    hangoverMs: Math.max(0, c.hangoverMs),
    resumeGuardMs: Math.max(0, c.resumeGuardMs),
  };
}

/**
 * Where the machine is. `idle` is the companion talking unimpeded; `ducked` is
 * the volume down pending a verdict; `speaking` is the user holding the turn
 * with the playback stopped.
 */
export type TurnPhase = "idle" | "ducked" | "speaking";

export interface TurnDetectState {
  phase: TurnPhase;
  // Consecutive loud buffers seen while idle, capped at startFrames.
  loudFrames: number;
  // Timestamp of the most recent loud buffer of the current duck or turn.
  lastVoiceMs: number;
  // Timestamp of the duck that opened the current `ducked` phase.
  duckedAtMs: number;
  // Timestamp of the last `resume`, or null if none was ever announced.
  lastResumeMs: number | null;
}

export function initialTurnDetectState(): TurnDetectState {
  return { phase: "idle", loudFrames: 0, lastVoiceMs: 0, duckedAtMs: 0, lastResumeMs: null };
}

export interface TurnDetectStep {
  state: TurnDetectState;
  event: TurnEvent | null;
}

/**
 * One audio buffer's level, at the moment the buffer was handed over.
 *
 * `db` is dBFS of that buffer, `-Infinity` for digital silence; NaN and
 * -Infinity both compare false against the threshold, so silence is quiet
 * rather than an exception. Pure: same state and arguments, same answer.
 *
 * The caller may also drive time with no audio — `step(state, cfg,
 * Number.NEGATIVE_INFINITY, now)` on a timer — which is how a turn still ends,
 * and a stale duck still resumes, when the tap stops delivering buffers.
 */
export function stepTurnDetect(
  state: TurnDetectState,
  config: TurnDetectConfig,
  db: number,
  atMs: number,
): TurnDetectStep {
  const loud = db >= config.startDb;

  if (state.phase === "idle") {
    const loudFrames = loud ? Math.min(state.loudFrames + 1, config.startFrames) : 0;
    const guarded =
      state.lastResumeMs !== null && atMs - state.lastResumeMs < config.resumeGuardMs;
    if (loudFrames >= config.startFrames && !guarded) {
      return {
        state: { ...state, phase: "ducked", loudFrames: 0, lastVoiceMs: atMs, duckedAtMs: atMs },
        event: { type: "duck" },
      };
    }
    // Held back by the resume guard, loudFrames stays at the cap, so the first
    // buffer after it expires ducks instead of restarting the count on someone
    // who never stopped talking.
    return { state: { ...state, loudFrames }, event: null };
  }

  if (state.phase === "ducked") {
    // Sustained means "no silent run of resumeMs got through", not "some loud
    // buffer arrived". Counting buffers would make the verdict depend on the
    // delivery rate, and this tap's rate is not a constant. The silent-run
    // rule is the same shape as the hangover, so the Swift port has one timer
    // idea rather than two.
    if (loud) {
      if (atMs - state.duckedAtMs >= config.confirmMs) {
        return {
          state: { ...state, phase: "speaking", loudFrames: 0, lastVoiceMs: atMs },
          event: { type: "stop" },
        };
      }
      return { state: { ...state, loudFrames: 0, lastVoiceMs: atMs }, event: null };
    }
    if (atMs - state.lastVoiceMs >= config.resumeMs) {
      return {
        state: { ...state, phase: "idle", loudFrames: 0, lastResumeMs: atMs },
        event: { type: "resume" },
      };
    }
    return { state, event: null };
  }

  // Mid-turn. A loud buffer refreshes the hangover; it is never also tested
  // against it, so a delivery gap followed by speech extends the turn rather
  // than chopping it in two. The cost of that choice is a late reply, and the
  // cost of the other one is cutting the user off over a dropped buffer.
  if (loud) {
    return { state: { ...state, loudFrames: 0, lastVoiceMs: atMs }, event: null };
  }

  const silentMs = atMs - state.lastVoiceMs;
  if (silentMs >= config.hangoverMs) {
    return {
      state: { ...state, phase: "idle", loudFrames: 0 },
      event: { type: "end", silentMs },
    };
  }
  return { state, event: null };
}

export interface TurnDetector {
  readonly config: TurnDetectConfig;
  /** Feed one buffer's level. Returns the event it produced, or null. */
  step(db: number, atMs: number): TurnEvent | null;
  /** Current state, for tests and for logging what the machine believes. */
  snapshot(): TurnDetectState;
  /** Back to silence without announcing anything, e.g. when the call ends. */
  reset(): void;
}

/** The stateful wrapper a call session holds. The logic is stepTurnDetect. */
export function createTurnDetector(patch?: Partial<TurnDetectConfig>): TurnDetector {
  const config = resolveTurnDetectConfig(patch);
  let state = initialTurnDetectState();
  return {
    config,
    step(db: number, atMs: number): TurnEvent | null {
      const next = stepTurnDetect(state, config, db, atMs);
      state = next.state;
      return next.event;
    },
    snapshot(): TurnDetectState {
      return { ...state };
    },
    reset(): void {
      state = initialTurnDetectState();
    },
  };
}
