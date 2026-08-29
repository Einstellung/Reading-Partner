// Who is talking, decided from one number per audio buffer (docs/33, docs/45).
// The full-duplex call keeps the mic open while the companion speaks, so two
// edges have to be found in the level stream: the user STARTED (cut the
// playback now) and the user STOPPED (take the turn).
//
// The whole judgement is a dB threshold plus a hangover timer. That is the
// first version on purpose: zero bytes, zero licence, zero dependency, and the
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
  // The user started talking: stop the playback.
  | { type: "start" }
  // The user stopped: `silentMs` is the measured gap since their last loud
  // frame, which is >= hangoverMs and can be much larger if the tap stalled.
  | { type: "end"; silentMs: number };

export interface TurnDetectConfig {
  // A buffer at or above this dBFS counts as voice. Default -35: the most
  // conservative reading the probe supports (loudest echo frame -38.5).
  startDb: number;
  // How many consecutive loud buffers open a turn. 1 reacts in one buffer
  // (~110-200 ms); 2 costs one buffer of latency and buys threshold headroom,
  // because the echo tail crosses -50 dBFS in single isolated frames only.
  startFrames: number;
  // Silence this long after the last loud buffer closes the turn.
  hangoverMs: number;
  // No second `start` within this long of the last one. Guards the moment the
  // playback is cut: the AEC reference disappears with it, the residue rebounds
  // for a buffer or two, and that must not read as a fresh barge-in.
  refractoryMs: number;
}

export const DEFAULT_TURN_DETECT: TurnDetectConfig = {
  startDb: -35,
  startFrames: 1,
  hangoverMs: 800,
  refractoryMs: 300,
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
    hangoverMs: Math.max(0, c.hangoverMs),
    refractoryMs: Math.max(0, c.refractoryMs),
  };
}

export interface TurnDetectState {
  // The user is mid-turn: `start` was announced and `end` was not.
  speaking: boolean;
  // Consecutive loud buffers seen while not speaking, capped at startFrames.
  loudFrames: number;
  // Timestamp of the most recent loud buffer of the current turn.
  lastVoiceMs: number;
  // Timestamp of the last `start`, or null if none was ever announced.
  lastStartMs: number | null;
}

export function initialTurnDetectState(): TurnDetectState {
  return { speaking: false, loudFrames: 0, lastVoiceMs: 0, lastStartMs: null };
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
 * Number.NEGATIVE_INFINITY, now)` on a timer — which is how a turn still ends
 * when the tap stops delivering buffers altogether.
 */
export function stepTurnDetect(
  state: TurnDetectState,
  config: TurnDetectConfig,
  db: number,
  atMs: number,
): TurnDetectStep {
  const loud = db >= config.startDb;

  if (!state.speaking) {
    const loudFrames = loud ? Math.min(state.loudFrames + 1, config.startFrames) : 0;
    const refractory =
      state.lastStartMs !== null && atMs - state.lastStartMs < config.refractoryMs;
    if (loudFrames >= config.startFrames && !refractory) {
      return {
        state: { speaking: true, loudFrames: 0, lastVoiceMs: atMs, lastStartMs: atMs },
        event: { type: "start" },
      };
    }
    // Held back by the refractory window, loudFrames stays at the cap, so the
    // first buffer after it expires opens the turn instead of restarting the
    // count on someone who never stopped talking.
    return { state: { ...state, loudFrames }, event: null };
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
      state: { ...state, speaking: false, loudFrames: 0 },
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
