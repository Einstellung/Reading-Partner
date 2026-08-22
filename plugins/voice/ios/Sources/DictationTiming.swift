// The press's segments, on their way to the webview.
//
// Every number here is already an `RP-DICT <step> +<n>ms` line and every one of
// those lines stays. What this adds is a second road for the same numbers: the
// plugin hands them over when the hold ends and the bench appends them to its
// own file on the device (src/smoke/bench-journal.ts).
//
// It exists because the first road broke without saying so. Four audio profiles
// were held three times each on a phone; the transcripts came back and not one
// press-to-first-buffer number did, because the Mac's idevicesyslog was still
// running with a dead stream behind it. A measurement with one way out has none.
//
// Nothing here can carry what the user said, and nothing here may be made able
// to. The steps are milliseconds, the pre-roll is a count and two durations, the
// echo canceller's answer is two booleans. Same rule as the result log in
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

    /// The session's answer about echo cancellation without the voice-processing
    /// unit. Asking for it is not the same as being given it, so both halves are
    /// the system's own, read after activation rather than remembered from the
    /// press that configured it.
    struct EchoCancelledInput: Encodable {
        let available: Bool
        let enabled: Bool
    }

    /// The front end this hold opened the microphone on.
    let profile: String
    /// True when the microphone was inherited from the previous hold rather than
    /// built for this one. Only a reusing profile can say true, and a run of
    /// them that quietly rebuilt every time would otherwise read as "reuse does
    /// not help".
    let reused: Bool
    /// Milliseconds from the press to each step of the start.
    let steps: [String: Double]
    /// Milliseconds from the release to each step of the teardown. A different
    /// zero from `steps` on purpose: what letting go costs is the other half of
    /// the question `reuse` is asking, and measuring it from the press would
    /// bury it under the length of the hold.
    let teardown: [String: Double]
    let preroll: Preroll?
    /// Nil on the profiles that run the voice-processing unit, which never ask.
    let echoCancelledInput: EchoCancelledInput?

    enum CodingKeys: String, CodingKey {
        case profile, reused, steps, teardown, preroll, echoCancelledInput
    }

    /// Written by hand for one reason: a synthesised encoding leaves a nil
    /// optional out of the JSON altogether, and these lines are read afterwards
    /// by a person as well as by a parser. A missing key and a null one mean the
    /// same thing and do not look it.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(profile, forKey: .profile)
        try container.encode(reused, forKey: .reused)
        try container.encode(steps, forKey: .steps)
        try container.encode(teardown, forKey: .teardown)
        try container.encode(preroll, forKey: .preroll)
        try container.encode(echoCancelledInput, forKey: .echoCancelledInput)
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
    private var echo: DictationTiming.EchoCancelledInput?
    private var reused = false

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

    func recordEchoCancelledInput(available: Bool, enabled: Bool) {
        let value = DictationTiming.EchoCancelledInput(available: available, enabled: enabled)
        lock.lock()
        echo = value
        lock.unlock()
    }

    func recordReuse(_ value: Bool) {
        lock.lock()
        reused = value
        lock.unlock()
    }

    /// Everything gathered so far. Read once, when the hold is over, and safe on
    /// a run that never got past its first step: what it did reach is there and
    /// the rest is simply absent, which is itself the measurement when a start
    /// fails.
    func snapshot(profile: AudioProfile) -> DictationTiming {
        lock.lock()
        defer { lock.unlock() }
        return DictationTiming(
            profile: profile.rawValue,
            reused: reused,
            steps: steps,
            teardown: teardownSteps,
            preroll: preroll,
            echoCancelledInput: echo)
    }
}
