// The press's segments, on their way to the webview.
//
// The plugin hands them over when the hold ends and the bench appends them to
// its own file on the device (src/smoke/bench-journal.ts).
//
// It is the only road on a shipping build. The same numbers go out as
// `RP-DICT <step> +<n>ms` lines too, but only on a debug one (markStep): a build
// on somebody's phone has nothing to say about how long a press took to the
// system log.
//
// A file on the device rather than a log because the log broke without saying
// so. Four settings were held three times each on a phone; the transcripts came
// back and not one press-to-first-buffer number did, because the Mac's
// idevicesyslog was still running with a dead stream behind it. A measurement
// with one way out has none.
//
// Nothing here can carry what the user said, and nothing here may be made able
// to. The steps are milliseconds and the pre-roll is a count and two durations.
// The two strings are a stage name from an enum and one of a handful of
// sentences written in AudioFront; neither is built from anything a press
// produced, and neither may become so. Same rule as the result log in
// DictationRun.handle: shape and timing, never the words.

import Foundation

/// One hold's timings, as the webview receives them.
struct DictationTiming: Encodable {
    /// What the pre-roll was holding when the recogniser took over: how many tap
    /// buffers, how much audio they were worth, how much older audio the cap had
    /// already dropped, and how long the hand-over itself took. Nil on a hold
    /// that never reached the hand-over.
    struct Preroll: Encodable {
        let buffers: Int
        let ms: Double
        let droppedMs: Double
        let handoverMs: Double
    }

    /// True when the microphone was inherited from the hold before it rather
    /// than built for this one. False on the first hold of a voice mode and on
    /// every hold after something took the microphone back; a voice mode that
    /// quietly rebuilt every time would otherwise read as "reuse does not help".
    let reused: Bool
    /// Why the microphone was built rather than inherited. Nil when it was
    /// inherited. It exists because the round of 2026-08-22 came back with
    /// `reused` false on all ten holds that had asked for it and no way to tell
    /// from the file why (docs/pitfall/168) — a false with nothing beside it is
    /// the silent failure this pair is against.
    let reuseSkipped: String?
    /// Where the indicator probe was standing when the finger went down:
    /// `never` if nothing has probed in this process, `off` if something did and
    /// put it back, `unread` on a press that never reached the microphone, and
    /// otherwise the stage it was parked on.
    let probeStage: String
    /// Whether a probe had been in the audio stack since the previous hold. This
    /// is the one that says whether the press was refused, and `probeStage`
    /// beside it is not: putting the probe back on `off` tears the stack down
    /// like every other probe call, so a press can find nothing parked and still
    /// be the first one after the engine it meant to reuse was demolished
    /// (docs/pitfall/168). True on exactly one press per probe excursion — the
    /// refused one — and false on every hold that ran.
    let probeTouched: Bool
    /// Milliseconds from the press to each step of the start.
    let steps: [String: Double]
    /// Milliseconds from the release to each step of the teardown. A different
    /// zero from `steps` on purpose: what letting go costs is the other half of
    /// the question `reuse` is asking, and measuring it from the press would
    /// bury it under the length of the hold.
    let teardown: [String: Double]
    let preroll: Preroll?

    enum CodingKeys: String, CodingKey {
        case reused, reuseSkipped, probeStage, probeTouched, steps, teardown, preroll
    }

    /// Written by hand for one reason: a synthesised encoding leaves a nil
    /// optional out of the JSON altogether, and these lines are read afterwards
    /// by a person as well as by a parser. A missing key and a null one mean the
    /// same thing and do not look it.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(reused, forKey: .reused)
        try container.encode(reuseSkipped, forKey: .reuseSkipped)
        try container.encode(probeStage, forKey: .probeStage)
        try container.encode(probeTouched, forKey: .probeTouched)
        try container.encode(steps, forKey: .steps)
        try container.encode(teardown, forKey: .teardown)
        try container.encode(preroll, forKey: .preroll)
    }
}

/// The event it leaves on. The same event name as the transcript's — a plugin
/// can only trigger into channels something registered by name, and a second
/// name would be a second registration for every listener that wants both — with
/// a kind of its own, which is what the webview's reducer switches on.
struct DictationTimingEvent: Encodable {
    let kind = "timing"
    let timing: DictationTiming
}

/// Where the steps are gathered while the hold runs.
///
/// Locked because the marks come from three threads: the start task, the audio
/// thread on the first buffer, and the teardown on the plugin's serial chain.
/// The lock is held for one dictionary write and nothing else — never across a
/// call into the audio stack, which is the rule AudioFront's own two locks
/// follow.
final class TimingLog {
    private let lock = NSLock()
    private var steps: [String: Double] = [:]
    private var teardownSteps: [String: Double] = [:]
    private var preroll: DictationTiming.Preroll?
    private var reused = false
    private var reuseSkipped: String?
    /// Until the front end is reached there is nothing to report: a press that
    /// failed on the permission prompt never asked where the probe was, and
    /// saying `never` for it would be an answer nobody measured.
    private var probeStage = "unread"
    private var probeTouched = false

    /// Logs the step and keeps it. Both roads from one call, so a step can never
    /// reach one and not the other.
    func mark(_ step: String, since start: CFAbsoluteTime) {
        record(step, ms: markStep(step, since: start))
    }

    /// The same, measured from the release rather than from the press.
    func markTeardown(_ step: String, since start: CFAbsoluteTime) {
        let ms = markStep(step, since: start)
        lock.lock()
        teardownSteps[step] = ms
        lock.unlock()
    }

    /// A step whose line is printed elsewhere, in a shape this one cannot
    /// produce — `firstBuffer` carries the frame count and the sample rate with
    /// it, and that line is what pitfall 161 is argued from.
    func record(_ step: String, ms: Double) {
        lock.lock()
        steps[step] = ms
        lock.unlock()
    }

    func recordPreroll(buffers: Int, ms: Double, droppedMs: Double, handoverMs: Double) {
        let value = DictationTiming.Preroll(
            buffers: buffers, ms: ms, droppedMs: droppedMs, handoverMs: handoverMs)
        lock.lock()
        preroll = value
        lock.unlock()
    }

    func recordReuse(_ value: Bool) {
        lock.lock()
        reused = value
        lock.unlock()
    }

    /// The reason the fast path was not taken. One of a handful of sentences
    /// written in AudioFront, never anything the press produced.
    func recordReuseSkipped(_ reason: String) {
        lock.lock()
        reuseSkipped = reason
        lock.unlock()
    }

    func recordProbeStage(_ value: String, touched: Bool) {
        lock.lock()
        probeStage = value
        probeTouched = touched
        lock.unlock()
    }

    /// Everything gathered so far. Read once, when the hold is over, and safe on
    /// a run that never got past its first step: what it did reach is there and
    /// the rest is simply absent, which is itself the measurement when a start
    /// fails.
    func snapshot() -> DictationTiming {
        lock.lock()
        defer { lock.unlock() }
        return DictationTiming(
            reused: reused,
            reuseSkipped: reuseSkipped,
            probeStage: probeStage,
            probeTouched: probeTouched,
            steps: steps,
            teardown: teardownSteps,
            preroll: preroll)
    }
}
