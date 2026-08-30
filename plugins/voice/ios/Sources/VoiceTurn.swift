// Who is talking, decided from one number per audio buffer: the Swift half of
// src/info/companion/turn-detect.ts, transliterated line for line.
//
// The TypeScript file is the specification and tests/info/turn-detect.test.ts is
// its proof, against fixtures recorded on this phone. Nothing here is allowed to
// be a better idea than what is over there: same phases, same transitions, same
// field names, same defaults, same events. A difference between the two files is
// a bug in this one until the other one is changed first.
//
// This machine runs inside the tap callback on the audio thread, so it obeys
// that thread's rules: no allocation (every type below is a value type of
// Doubles, an Int and an enum, and the returned event carries one Double
// inline), no lock, no logging, no clock. `atMs` is a monotonic wall clock the
// caller passes in, never a frame count times an assumed buffer length — the tap
// on device delivers at 5.5-10 Hz and the same build measured different rates on
// different runs.
//
// Two behaviours differ between JavaScript and Swift and are handled where they
// occur, marked "JS/Swift" in the body: integer overflow traps here and wraps
// there, and `max` disagrees about NaN. Everything else in this machine is a
// Double comparison, and IEEE 754 makes those identical in both languages —
// `NaN >= x`, `-inf >= finite` and `-inf >= -inf` all answer the same in each.

import Foundation

/// What one step can announce. At most one per step.
///
/// Named `VoiceTurnEvent` rather than `TurnEvent`, which the turn probe in
/// SpeechProbe.swift already uses for a recorded measurement. Same module, so
/// one of the two names had to give, and the probe's is the one already written
/// into a report the harness parses.
enum VoiceTurnEvent: Equatable {
    /// Someone crossed the line and it looks like the user. Duck the playback:
    /// drop the volume, do not tear anything down. Not yet a turn.
    case duck
    /// The voice held past `confirmMs`, so it is the user. Stop the playback for
    /// real and hand them the turn.
    ///
    /// This is also where the caller reads off how much of the companion's reply
    /// actually reached the user, for the transcript it keeps and for whatever it
    /// tells the model was said. Not at the duck: ducking only lowers the volume,
    /// and everything played between the duck and here was still audible. The
    /// authoritative moment is the one where the audio truly stopped.
    case stop
    /// It went quiet before `confirmMs` was up, so the duck was a false alarm.
    /// Put the volume back. The turn never happened; no `stop`, no `end`.
    case resume
    /// The user stopped: `silentMs` is the measured gap since their last loud
    /// frame, which is >= hangoverMs and can be much larger if the tap stalled.
    /// Only ever follows a `stop` — a turn has to be taken before it can end.
    case end(silentMs: Double)
}

struct TurnDetectConfig: Equatable {
    /// A buffer at or above this dBFS counts as voice. Default -35: the most
    /// conservative reading the probe supports (loudest echo frame -38.5).
    let startDb: Double
    /// How many consecutive loud buffers duck the playback. 1 reacts in one
    /// buffer (~110-200 ms); 2 costs one buffer of latency and buys threshold
    /// headroom, because the echo tail crosses -50 dBFS in single frames only.
    let startFrames: Int
    /// Voice has to still be there this long after the duck to escalate to
    /// `stop`. Default 300: longer than the widest buffer interval the probe
    /// measured (208 ms), so confirming always takes a *later* delivery than the
    /// one that ducked and no single-buffer artefact can reach `stop`; and well
    /// inside the 597 ms first voice run of the recorded barge-in, so a real
    /// barge-in confirms without waiting for a second run. The cost is that an
    /// utterance too short to span it ducks and resumes without taking the turn.
    let confirmMs: Double
    /// Silence this long while ducked calls the duck a false alarm. Default 300:
    /// above the 117 and 185 ms dips measured *inside* the recorded barge-in's
    /// speech, and far below the 802 ms shortest real pause in it, so a dropped
    /// buffer or a stop consonant does not un-duck mid-word.
    let resumeMs: Double
    /// Silence this long after the last loud buffer closes the turn. Default
    /// 1250: the recorded barge-in has a 1403 ms pause in the middle of a
    /// sentence, and the break-even that keeps it one turn is 1220, not 1403 —
    /// the tap only ever *observed* 1219 ms of that pause, because the buffer
    /// that would have measured more arrived loud. Silence measured on a sampled
    /// stream is always shorter than the pause it samples, and that gap is the
    /// entire difference between 1220 and 1500.
    ///
    /// 800 was the first guess and it costs a turn: it cuts that barge-in in two
    /// and starts the reply 298 ms before the person's last word. 1250 clears
    /// the break-even by 30 ms and pays for it in reply latency, which is always
    /// the hangover plus up to one delivery interval.
    let hangoverMs: Double
    /// No new duck within this long of a `resume`. A resume ramps the volume back
    /// up; without this, a source sitting on the threshold ducks and resumes at
    /// the buffer rate and the playback audibly flutters. The probe's own echo
    /// stage does this once the threshold is loosened to where the echo crosses
    /// at all: at -55 dBFS its isolated crossings land 323 and 481 ms apart.
    let resumeGuardMs: Double

    /// The defaults, and the clamping `resolveTurnDetectConfig` does over there.
    /// One initialiser covers both: calling it with nothing is
    /// `DEFAULT_TURN_DETECT`, calling it with one argument is the patch.
    ///
    /// Fewer than one frame is one frame; negative durations are zero.
    /// `Math.floor` has no counterpart because `startFrames` is an `Int` here
    /// and a fractional frame count cannot be expressed.
    ///
    /// JS/Swift: `Math.max(0, NaN)` is NaN, `Swift.max(0, .nan)` is 0, because
    /// Swift's `max` answers `y >= x ? y : x` and NaN loses every comparison. A
    /// NaN duration reaches this initialiser from nowhere — the fields are
    /// literals at every call site — and 0 is the answer that keeps the machine
    /// running, so the difference is recorded rather than reproduced.
    init(
        startDb: Double = -35,
        startFrames: Int = 1,
        confirmMs: Double = 300,
        resumeMs: Double = 300,
        hangoverMs: Double = 1250,
        resumeGuardMs: Double = 300
    ) {
        self.startDb = startDb
        self.startFrames = max(1, startFrames)
        self.confirmMs = max(0, confirmMs)
        self.resumeMs = max(0, resumeMs)
        self.hangoverMs = max(0, hangoverMs)
        self.resumeGuardMs = max(0, resumeGuardMs)
    }
}

/// Where the machine is. `idle` is the companion talking unimpeded; `ducked` is
/// the volume down pending a verdict; `speaking` is the user holding the turn
/// with the playback stopped.
// No raw value and no explicit conformance: nothing reads a name off this, and
// `: String` would let `==` resolve to `RawRepresentable`'s, which builds two
// Strings per comparison. The audio thread runs one or two of these per buffer.
enum TurnPhase {
    case idle
    case ducked
    case speaking
}

struct TurnDetectState: Equatable {
    var phase: TurnPhase = .idle
    /// Consecutive loud buffers seen while idle, capped at startFrames.
    var loudFrames: Int = 0
    /// Timestamp of the most recent loud buffer of the current duck or turn.
    var lastVoiceMs: Double = 0
    /// Timestamp of the duck that opened the current `ducked` phase.
    var duckedAtMs: Double = 0
    /// Timestamp of the last `resume`, or nil if none was ever announced.
    var lastResumeMs: Double?
}

struct TurnDetectStep {
    let state: TurnDetectState
    let event: VoiceTurnEvent?
}

/// One audio buffer's level, at the moment the buffer was handed over.
///
/// `db` is dBFS of that buffer, `-infinity` for digital silence; NaN and
/// -infinity both compare false against the threshold, so silence is quiet
/// rather than an exception. Pure: same state and arguments, same answer.
///
/// The caller may also drive time with no audio — `stepTurnDetect(state, cfg,
/// -.infinity, now)` on a timer — which is how a turn still ends, and a stale
/// duck still resumes, when the tap stops delivering buffers.
func stepTurnDetect(
    _ state: TurnDetectState,
    _ config: TurnDetectConfig,
    _ db: Double,
    _ atMs: Double
) -> TurnDetectStep {
    let loud = db >= config.startDb

    if state.phase == .idle {
        // JS/Swift: `Math.min(loudFrames + 1, startFrames)` written as a
        // comparison. `loudFrames` is never above the cap, so at the cap the
        // answer is the cap — and the addition that would trap on
        // `startFrames == Int.max` never happens.
        let loudFrames =
            loud
            ? (state.loudFrames >= config.startFrames
                ? config.startFrames : state.loudFrames + 1)
            : 0
        // `lastResumeMs !== null && atMs - lastResumeMs < resumeGuardMs`. Never
        // resumed is never guarded, which is what the null half says over there.
        var guarded = false
        if let lastResumeMs = state.lastResumeMs {
            guarded = atMs - lastResumeMs < config.resumeGuardMs
        }
        if loudFrames >= config.startFrames && !guarded {
            var next = state
            next.phase = .ducked
            next.loudFrames = 0
            next.lastVoiceMs = atMs
            next.duckedAtMs = atMs
            return TurnDetectStep(state: next, event: .duck)
        }
        // Held back by the resume guard, loudFrames stays at the cap, so the
        // first buffer after it expires ducks instead of restarting the count on
        // someone who never stopped talking.
        var next = state
        next.loudFrames = loudFrames
        return TurnDetectStep(state: next, event: nil)
    }

    if state.phase == .ducked {
        // Sustained means "no silent run of resumeMs got through", not "some loud
        // buffer arrived". Counting buffers would make the verdict depend on the
        // delivery rate, and this tap's rate is not a constant. The silent-run
        // rule is the same shape as the hangover, so this port has one timer idea
        // rather than two.
        if loud {
            if atMs - state.duckedAtMs >= config.confirmMs {
                var next = state
                next.phase = .speaking
                next.loudFrames = 0
                next.lastVoiceMs = atMs
                return TurnDetectStep(state: next, event: .stop)
            }
            var next = state
            next.loudFrames = 0
            next.lastVoiceMs = atMs
            return TurnDetectStep(state: next, event: nil)
        }
        if atMs - state.lastVoiceMs >= config.resumeMs {
            var next = state
            next.phase = .idle
            next.loudFrames = 0
            next.lastResumeMs = atMs
            return TurnDetectStep(state: next, event: .resume)
        }
        return TurnDetectStep(state: state, event: nil)
    }

    // Mid-turn. A loud buffer refreshes the hangover; it is never also tested
    // against it, so a delivery gap followed by speech extends the turn rather
    // than chopping it in two. The cost of that choice is a late reply, and the
    // cost of the other one is cutting the user off over a dropped buffer.
    if loud {
        var next = state
        next.loudFrames = 0
        next.lastVoiceMs = atMs
        return TurnDetectStep(state: next, event: nil)
    }

    let silentMs = atMs - state.lastVoiceMs
    if silentMs >= config.hangoverMs {
        var next = state
        next.phase = .idle
        next.loudFrames = 0
        return TurnDetectStep(state: next, event: .end(silentMs: silentMs))
    }
    return TurnDetectStep(state: state, event: nil)
}

/// The stateful wrapper a call session holds, `createTurnDetector`'s shape as a
/// value type. The logic is `stepTurnDetect`.
///
/// A struct rather than a class so the caller can hold it inline in whatever
/// owns the tap: a class instance would be a heap object whose retain and
/// release run on the audio thread.
struct VoiceTurn {
    let config: TurnDetectConfig
    /// Current state, for tests and for logging what the machine believes.
    private(set) var state = TurnDetectState()

    init(config: TurnDetectConfig = TurnDetectConfig()) {
        self.config = config
    }

    /// Feed one buffer's level. Returns the event it produced, or nil.
    mutating func step(db: Double, atMs: Double) -> VoiceTurnEvent? {
        let next = stepTurnDetect(state, config, db, atMs)
        state = next.state
        return next.event
    }

    /// Back to silence without announcing anything, e.g. when the call ends.
    mutating func reset() {
        state = TurnDetectState()
    }
}
