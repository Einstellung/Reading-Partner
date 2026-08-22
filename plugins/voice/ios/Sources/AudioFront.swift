// The microphone itself, held apart from the hold that listens to it.
//
// It exists because of one measurement. Press to first audio buffer is
// 1090-1315 ms on an iPhone 16 running iOS 26.6, and two lines hold most of it:
// `setVoiceProcessingEnabled(true)`, which rebuilds the whole IO unit, and
// `engine.start()` on the unit it rebuilt. The first read of the hardware
// format is not one of them — 0-12 ms in all 21 holds of 2026-08-22 — and an
// earlier note here that billed it alongside the rebuild was wrong. The second,
// third and fifth press cost the same as the first, which is the tell: the
// engine was torn down between them and rebuilt from nothing every time.
//
// So the engine, the session and the tap moved out of DictationRun, whose
// lifetime is one press, and into an object whose lifetime is the process. What
// a press does to it is now a parameter — see AudioProfile — and one build can
// be held five times on each setting and the numbers compared. Nothing here
// picks a winner; `current` reproduces exactly what the shipping path did when
// this file was written, and it is the default everywhere the frontend does not
// say otherwise.
//
// Every profile is measured with the same `RP-DICT <step> +<n>ms` lines the run
// already emitted, at the same names, so a log from before this file and a log
// from after it line up column for column. `session` still means "the audio
// session is active", `capturing` still means "the engine is running with a tap
// on it". What is new is the pair between them — `voiceProcessing` and
// `microphoneFormat` — which is what tells the IO unit's rebuild apart from the
// format read that used to be blamed with it.
//
// One rule this file enforces rather than describes: the indicator probe below
// and a hold cannot share the microphone, and a hold that arrives while the
// probe is parked is refused. It used to take the microphone back instead, and
// a round of twenty-one holds went in the bin for it — every press that
// followed a parked probe paid to tear that probe's engine down first, the bill
// landed on the `session` step, and nothing in the record said so
// (docs/pitfall/168).
//
// Locks: `lock` guards the state machine below and is the one held across calls
// into AVAudioEngine. `sinkLock` guards a single closure reference and is the
// only lock the tap callback takes. They are always taken in that order and
// never the other way round, which is what keeps `engine.pause()` — a call that
// waits for the audio thread to come to rest — from waiting on a tap callback
// that is itself waiting for the lock the pauser holds.

import AVFoundation
import Foundation

/// What a press is allowed to reuse and which echo canceller it runs.
///
/// Two independent choices, so four cases:
///
///   engine     `current` and `echoCancelledInput` tear the engine down when the
///              finger lifts, the way the shipping path always did.  `reuse` and
///              `reuseEchoCancelledInput` keep it — `pause()` rather than
///              `stop()`, because Apple documents `stop()` as releasing the
///              resources `prepare()` allocated and `pause()` as keeping them.
///              The session stays active too, which is the cost: whatever the
///              orange indicator answers to an active session, it answers
///              between holds as well.
///   canceller  `current` and `reuse` use the voice-processing IO unit, whose
///              reference signal is by construction what this app plays.
///              `echoCancelledInput` and `reuseEchoCancelledInput` ask the
///              session for `setPrefersEchoCancelledInput(true)` instead, which
///              Apple says "does not require explicit voice processing
///              configuration" — and which therefore skips the IO unit rebuild.
///              Worth 300-450 ms of the press when it was measured on
///              2026-08-22. It is iOS 18.2 and later on iPhones from
///              2024 on, it is available only under `.playAndRecord` with mode
///              `.default`, and asking for it is not the same as getting it:
///              `isEchoCancelledInputEnabled` is the system's answer and it is
///              logged rather than assumed.
enum AudioProfile: String {
    case current
    case reuse
    case echoCancelledInput
    case reuseEchoCancelledInput

    /// Anything unrecognised is the shipping path. The tag crosses the webview
    /// boundary as a bare string and a build that does not know a newer name
    /// should measure the baseline, not refuse to record.
    static func parse(_ tag: String?) -> AudioProfile {
        guard let tag = tag, let profile = AudioProfile(rawValue: tag) else { return .current }
        return profile
    }

    var keepsEngine: Bool {
        self == .reuse || self == .reuseEchoCancelledInput
    }

    var usesVoiceProcessing: Bool {
        self == .current || self == .reuse
    }
}

/// How far up the audio stack the indicator probe stops, and stays.
///
/// The orange microphone indicator has no normative documentation of any kind —
/// Apple describes what it means, never what turns it on — so the only way to
/// learn which of these four steps lights it is to stop at each one and look at
/// the status bar. Nothing here transcribes, and `recording` keeps no audio: it
/// reads each buffer's samples and drops them, so that the difference between it
/// and `tap` is whether the audio is really being consumed rather than merely
/// delivered.
///
/// Whatever it measures is an observation and not a contract. A later iOS may
/// light the indicator one step earlier without telling anybody.
enum IndicatorStage: String {
    case off
    case session
    case engine
    case tap
    case recording
}

/// The probe's answer, which is the whole of what the bench can show about it:
/// where it stopped, and enough of the stack's state to prove it stopped there.
/// Encoded straight to the invoke, so the property names are the wire names and
/// the Rust struct beside it has to spell the same ones.
struct IndicatorProbeState: Encodable {
    let stage: String
    let sessionActive: Bool
    let engineRunning: Bool
    let tapInstalled: Bool
    /// How many buffers the tap has delivered since this stage was entered. Zero
    /// on the two stages that install no tap, and the only thing that separates
    /// "a tap is installed" from "a tap is being called".
    let buffers: Int
    /// Linear RMS of the last buffer read, on the recording stage only. A number
    /// about loudness, never about what was said.
    let level: Double
    let inputs: String
}

/// One `RP-DICT <step> +<n>ms` line. Shared with DictationRun so that the steps
/// on either side of the hand-off are the same shape and measured from the same
/// zero — the moment the finger went down.
///
/// Returns what it printed, so that TimingLog can keep the same number without
/// reading the clock a second time and disagreeing with the log by a hair. The
/// result is not discardable: a step worth a line is a step worth keeping, and
/// the compiler asking about it is how the two roads stay in step.
func markStep(_ step: String, since start: CFAbsoluteTime) -> Double {
    let ms = (CFAbsoluteTimeGetCurrent() - start) * 1000
    NSLog("RP-DICT %@ +%.0fms", step, ms)
    return ms
}

/// A format as one comparable line. Sample rate, channels, layout and sample
/// type are all things that have silently differed from what was expected here
/// (docs/pitfall/132, /133), so all four are printed.
func describeFormat(_ format: AVAudioFormat) -> String {
    "\(Int(format.sampleRate))Hz \(format.channelCount)ch "
        + "\(format.isInterleaved ? "interleaved" : "deinterleaved") "
        + "fmt=\(format.commonFormat.rawValue)"
}

final class AudioFront {
    /// One microphone, one process. A second engine on the same session is the
    /// failure that leaves a microphone open with nobody listening, and the
    /// whole point of `reuse` is that something outlives the press.
    static let shared = AudioFront()

    /// What `open` hands back: the engine, which the caller watches for
    /// reconfiguration and re-reads the input format from once the recogniser is
    /// up, and the format the tap was installed with. Whether this press paid
    /// for the build or inherited it is in the log, not here — nothing in a run
    /// behaves differently for it.
    struct Opened {
        let engine: AVAudioEngine
        let format: AVAudioFormat
    }

    private let lock = NSLock()
    private var engine: AVAudioEngine?
    private var openProfile: AudioProfile?
    private var format: AVAudioFormat?
    private var tapInstalled = false
    private var sessionActive = false
    private var stage: IndicatorStage = .off
    /// Whether anything has asked for a probe in this process. `off` and "never
    /// probed" leave the same state behind and are not the same fact about a
    /// press: one of them means somebody parked the microphone and put it back.
    private var probeEverSet = false

    /// The one thing the audio thread reads. Guarded by its own lock and never
    /// called while that lock is held.
    private let sinkLock = NSLock()
    private var sink: ((AVAudioPCMBuffer) -> Void)?

    /// The probe's own tally, so a stage that is supposed to be consuming audio
    /// can be seen to be consuming it. Counts and a level, never content.
    private var probeBuffers = 0
    private var probeLevel: Float = 0

    private init() {}

    // MARK: - A hold

    /// Opens the microphone under `profile` and points it at `sink`.
    ///
    /// Synchronous on purpose, like every other lock-taking helper in this
    /// plugin: taking a lock directly inside an `async` function blocks a
    /// cooperative thread, which the compiler warns about and Swift 6 rejects.
    ///
    /// `pressedAt` is the caller's zero, not this call's, so the lines this
    /// emits are directly comparable with the ones the run emits after it.
    /// `timing` is the run's, for the same reason: the steps this half of the
    /// press produces and the steps the other half produces end up in one
    /// record, which is what the bench writes to the device (DictationTiming).
    func open(
        profile: AudioProfile,
        pressedAt: CFAbsoluteTime,
        timing: TimingLog,
        sink: @escaping (AVAudioPCMBuffer) -> Void
    ) throws -> Opened {
        lock.lock()
        defer { lock.unlock() }

        // Where the probe was standing when the finger went down, recorded
        // whatever happens next. A press whose numbers cannot be checked against
        // it afterwards is a press nobody can trust.
        timing.recordProbeStage(probeStageNameLocked())

        // A probe and a hold cannot share the microphone. Taking the microphone
        // back would work and would also be a lie: the teardown is charged to
        // this press, its `session` step comes back five to ten times its usual
        // size, and the log reads as an ordinary slow press (docs/pitfall/168).
        // So the hold is refused and the person is told which button to press.
        if stage != .off {
            NSLog("RP-DICT front refused a hold: the probe is parked on %@", stage.rawValue)
            throw DictationError(
                "The indicator probe is parked on \(stage.rawValue). "
                    + "Put it back on Off before holding to talk.")
        }

        if let reused = reuseLocked(
            profile: profile, pressedAt: pressedAt, timing: timing, sink: sink)
        {
            return reused
        }
        return try openFreshLocked(
            profile: profile, pressedAt: pressedAt, timing: timing, sink: sink)
    }

    /// The fast path: an engine from a previous press, still built, still voice-
    /// processed, still tapped. Returns nil when there is nothing to reuse or
    /// when what there is cannot be trusted, and the caller then pays for a
    /// fresh one — every reason is logged, because a `reuse` run that quietly
    /// rebuilt every time would read as "reuse does not help".
    private func reuseLocked(
        profile: AudioProfile,
        pressedAt: CFAbsoluteTime,
        timing: TimingLog,
        sink: @escaping (AVAudioPCMBuffer) -> Void
    ) -> Opened? {
        guard profile.keepsEngine else { return nil }
        guard let engine = engine, let format = format, tapInstalled, sessionActive else {
            timing.recordReuseSkipped("nothing was standing to reuse")
            return nil
        }
        guard openProfile == profile else {
            timing.recordReuseSkipped(
                "what was standing belonged to \(openProfile?.rawValue ?? "no profile")")
            return nil
        }

        // The graph can move while nobody is holding it — a headset, a call, a
        // route change. A tap whose format disagrees with the node it sits on is
        // never called at all rather than failing, so this is checked instead of
        // assumed (docs/pitfall/132).
        let current = engine.inputNode.outputFormat(forBus: 0)
        guard current.isEqual(format) else {
            NSLog(
                "RP-DICT front cannot reuse: the microphone went from %@ to %@",
                describeFormat(format), describeFormat(current))
            timing.recordReuseSkipped("the microphone changed format between holds")
            teardownLocked()
            return nil
        }

        setSink(sink)
        // Marked before the restart rather than after it: on this path the
        // session never went inactive and the IO unit was never rebuilt, so
        // these three are what the press inherited and not what it paid for.
        // What restarting a paused engine costs then stands on its own, as
        // `capturing` minus `microphoneFormat`, which is the number `reuse` is
        // being run to find out.
        timing.mark("session", since: pressedAt)
        timing.mark("voiceProcessing", since: pressedAt)
        timing.mark("microphoneFormat", since: pressedAt)
        if !engine.isRunning {
            do {
                try engine.start()
            } catch {
                NSLog("RP-DICT front reuse start failed: %@", DictationError.describe(error))
                timing.recordReuseSkipped("the kept engine would not start")
                teardownLocked()
                return nil
            }
        }
        guard engine.isRunning else {
            NSLog("RP-DICT front reuse start returned without running")
            timing.recordReuseSkipped("the kept engine started without running")
            teardownLocked()
            return nil
        }

        if !profile.usesVoiceProcessing {
            // Apple: the enabled state may change when the route changes to one
            // that cannot do it, a headset being the example. A kept session is
            // exactly where that goes unnoticed, so it is re-read rather than
            // remembered from the press that configured it.
            reportEchoCancelledInput(AVAudioSession.sharedInstance(), to: timing)
        }
        timing.recordReuse(true)
        NSLog("RP-DICT front reused profile=%@", profile.rawValue)
        return Opened(engine: engine, format: format)
    }

    /// The slow path, and the one every `current` press takes. This is the
    /// sequence the timings above were measured on, and the order is load-
    /// bearing: voice processing before any format is read, the format read
    /// before the tap, the tap before `prepare()`, and `mainMixerNode` touched
    /// by nobody (docs/pitfall/133).
    private func openFreshLocked(
        profile: AudioProfile,
        pressedAt: CFAbsoluteTime,
        timing: TimingLog,
        sink: @escaping (AVAudioPCMBuffer) -> Void
    ) throws -> Opened {
        teardownLocked()

        try configureSessionLocked(profile, timing: timing)
        timing.mark("session", since: pressedAt)

        let engine = AVAudioEngine()
        self.engine = engine
        let input = engine.inputNode

        if profile.usesVoiceProcessing {
            do {
                try input.setVoiceProcessingEnabled(true)
            } catch {
                throw DictationError(
                    "The microphone could not be prepared: \(DictationError.describe(error))")
            }
        }
        timing.mark("voiceProcessing", since: pressedAt)

        // Read after the session is active and voice processing is decided: both
        // change what the input node reports. This one read is the format the tap
        // is installed with, the format the pre-roll holds, and later the
        // converter's input side. It is not where the time goes: 0-12 ms in
        // every one of the 21 holds of 2026-08-22, on both the profiles that
        // rebuild the IO unit and the ones that do not. The line above it and
        // `startLocked` below it are what the press pays for.
        let hardwareFormat = input.outputFormat(forBus: 0)
        NSLog("RP-DICT microphone=%@", describeFormat(hardwareFormat))
        timing.mark("microphoneFormat", since: pressedAt)
        guard hardwareFormat.sampleRate > 0 else {
            throw DictationError(
                "The microphone did not open. The audio session never became active.")
        }

        setSink(sink)
        input.installTap(onBus: 0, bufferSize: 4096, format: hardwareFormat) {
            [weak self] buffer, _ in
            self?.deliver(buffer)
        }
        tapInstalled = true

        engine.prepare()
        try startLocked(engine)

        self.format = hardwareFormat
        openProfile = profile
        timing.recordReuse(false)
        NSLog("RP-DICT front built profile=%@", profile.rawValue)
        return Opened(engine: engine, format: hardwareFormat)
    }

    /// Lets go of the microphone at the end of a hold.
    ///
    /// `keep` is the caller's judgement, not this object's: a profile that
    /// reuses says yes, and a run whose session was interrupted or whose route
    /// went away says no however it was configured, because what would be kept
    /// is exactly the thing that just broke.
    func release(profile: AudioProfile, keep: Bool) {
        lock.lock()
        defer { lock.unlock() }

        // A parked probe is not this run's to let go of. It can only be standing
        // here after a refused hold — a probe stops a live run before it takes
        // the microphone, and `open` refuses a hold while one is parked — and
        // tearing it down on the way out of that refusal would undo the refusal
        // silently: the screen would still say the probe was on, the next press
        // would find a clean stack, and the round after it would be as
        // unreadable as the one this rule exists for (docs/pitfall/168).
        guard stage == .off else {
            NSLog("RP-DICT front left the probe on %@ through a release", stage.rawValue)
            return
        }

        setSink(nil)
        // `openProfile == profile` is the part that is not the caller's opinion:
        // a run that failed before it opened anything is still asked to release,
        // and if what is standing belongs to some other profile then nobody is
        // going to come back for it. Tearing down is the safe half of that
        // choice — the cost is one rebuild, and the alternative is a microphone
        // left open with nobody listening.
        guard keep, profile.keepsEngine, openProfile == profile, let engine = engine else {
            teardownLocked()
            return
        }
        // pause(), never stop(): Apple documents stop() as releasing what
        // prepare() allocated, which is the rebuild the next press would then
        // pay for again. The tap stays installed with nothing behind it; buffers
        // that arrive before the next press find a nil sink and are dropped.
        engine.pause()
        NSLog("RP-DICT front paused profile=%@ session=active", profile.rawValue)
    }

    // MARK: - The indicator probe

    /// Stops the audio stack at one step and stays there until something else
    /// is asked for. Nothing is transcribed, nothing is emitted and no audio is
    /// kept; the answer comes from the status bar of the phone in someone's
    /// hand.
    ///
    /// Always torn down first, so each stage is entered from nothing and the
    /// indicator's state is the state of that stage and not of its predecessor.
    /// Configured as the shipping path configures itself — `.playAndRecord`,
    /// `.voiceChat`, voice processing on — because the question is about what
    /// this app does, not about what is cheapest.
    func setIndicatorProbe(_ wanted: IndicatorStage) throws -> IndicatorProbeState {
        lock.lock()
        defer { lock.unlock() }

        teardownLocked()
        // Before the early return below, so that asking for `off` counts as
        // having probed: a stack put back by hand and a stack nobody has touched
        // are different facts about the press that follows.
        probeEverSet = true
        sinkLock.lock()
        probeBuffers = 0
        probeLevel = 0
        sinkLock.unlock()
        guard wanted != .off else {
            NSLog("RP-DICT probe off")
            return stateLocked()
        }

        // Nobody releases a probe the way a run releases a hold, so anything
        // half-configured has to be cleaned up here or it stays that way.
        do {
            try configureSessionLocked(.current, timing: nil)
        } catch {
            teardownLocked()
            throw error
        }
        if wanted == .session {
            stage = wanted
            NSLog("RP-DICT probe %@ session=active", wanted.rawValue)
            return stateLocked()
        }

        let engine = AVAudioEngine()
        self.engine = engine
        let input = engine.inputNode
        do {
            try input.setVoiceProcessingEnabled(true)
        } catch {
            teardownLocked()
            throw DictationError(
                "The microphone could not be prepared: \(DictationError.describe(error))")
        }
        let hardwareFormat = input.outputFormat(forBus: 0)

        if wanted != .engine {
            // The stage is captured here rather than read from the field, so the
            // audio thread never touches the state machine's lock.
            let reading = wanted == .recording
            setSink { [weak self] buffer in
                self?.countProbeBuffer(buffer, reading: reading)
            }
            input.installTap(onBus: 0, bufferSize: 4096, format: hardwareFormat) {
                [weak self] buffer, _ in
                self?.deliver(buffer)
            }
            tapInstalled = true
        }

        engine.prepare()
        do {
            try startLocked(engine)
        } catch {
            teardownLocked()
            throw error
        }

        stage = wanted
        NSLog(
            "RP-DICT probe %@ engine=running tap=%d microphone=%@",
            wanted.rawValue, tapInstalled ? 1 : 0, describeFormat(hardwareFormat))
        return stateLocked()
    }

    /// Where the probe is standing, as a press records it. `never` and `off`
    /// leave the same audio stack behind and are not the same answer: one of
    /// them means somebody parked the microphone during this run of the app and
    /// put it back, which is worth being able to see in the file afterwards.
    private func probeStageNameLocked() -> String {
        probeEverSet ? stage.rawValue : "never"
    }

    /// What the probe is doing right now, as the plugin answers it. Counts and a
    /// level; there is no path from here to anything the user said.
    private func stateLocked() -> IndicatorProbeState {
        let session = AVAudioSession.sharedInstance()
        sinkLock.lock()
        let buffers = probeBuffers
        let level = probeLevel
        sinkLock.unlock()
        return IndicatorProbeState(
            stage: stage.rawValue,
            sessionActive: sessionActive,
            engineRunning: engine?.isRunning ?? false,
            tapInstalled: tapInstalled,
            buffers: buffers,
            level: Double(level),
            inputs: session.currentRoute.inputs.map { $0.portType.rawValue }.joined(
                separator: ", "))
    }

    private func countProbeBuffer(_ buffer: AVAudioPCMBuffer, reading: Bool) {
        sinkLock.lock()
        probeBuffers += 1
        sinkLock.unlock()
        guard reading else { return }
        // Touch the samples, so that "recording" differs from "tapped" by more
        // than a name: the audio is read and then dropped. The result is stored
        // because an unread computation is one the optimiser may delete, and
        // because a level is the one number that shows the buffers are real.
        guard let channels = buffer.floatChannelData, buffer.frameLength > 0 else { return }
        let frames = Int(buffer.frameLength)
        let samples = channels[0]
        var sum: Float = 0
        for index in 0..<frames {
            let value = samples[index]
            sum += value * value
        }
        let rms = (sum / Float(frames)).squareRoot()
        sinkLock.lock()
        probeLevel = rms
        sinkLock.unlock()
    }

    // MARK: - Session

    private func configureSessionLocked(_ profile: AudioProfile, timing: TimingLog?) throws {
        let session = AVAudioSession.sharedInstance()
        do {
            if profile.usesVoiceProcessing {
                // .voiceChat is the mode the voice-processing unit wants, and it
                // sets HFP itself, so no Bluetooth option here.
                try session.setCategory(
                    .playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker])
            } else {
                // Both halves are required by setPrefersEchoCancelledInput and
                // neither is negotiable: Apple documents the flag as valid "only
                // when used with .playAndRecord category and .default mode".
                // Nothing is said about options, and .defaultToSpeaker is what
                // puts playback on the speaker — which is the echo this is
                // asking to have cancelled. Whether the system honoured any of
                // it is read back below rather than assumed.
                try session.setCategory(
                    .playAndRecord, mode: .default, options: [.defaultToSpeaker])
            }
        } catch {
            throw DictationError(
                "The microphone is in use by something else: \(DictationError.describe(error))")
        }

        if !profile.usesVoiceProcessing {
            preferEchoCancelledInput(session, when: "configured")
        }

        do {
            try session.setActive(true)
        } catch {
            throw DictationError(
                "The microphone is in use by something else: \(DictationError.describe(error))")
        }
        sessionActive = true

        if !profile.usesVoiceProcessing {
            // Asked again after activation, and logged either way. Availability
            // is a property of the current route, which activation is what
            // settles; and asking for the flag is not the same as being given
            // it, so what the system says afterwards is the measurement.
            if !session.isEchoCancelledInputEnabled {
                preferEchoCancelledInput(session, when: "activated")
            }
            reportEchoCancelledInput(session, to: timing)
        }
    }

    /// What the system says about echo cancellation, logged and kept. Both
    /// halves are read here rather than assumed anywhere: availability is a
    /// property of the current route, and a phone that was asked is not a phone
    /// that agreed.
    private func reportEchoCancelledInput(_ session: AVAudioSession, to timing: TimingLog?) {
        let available = session.isEchoCancelledInputAvailable
        let enabled = session.isEchoCancelledInputEnabled
        NSLog(
            "RP-DICT echoCancelledInput available=%d enabled=%d",
            available ? 1 : 0, enabled ? 1 : 0)
        timing?.recordEchoCancelledInput(available: available, enabled: enabled)
    }

    /// Asks for echo cancellation without the voice-processing IO unit. Never
    /// fatal: a phone that refuses is a phone whose hold runs without echo
    /// cancellation, which is a worse recording and a perfectly good
    /// measurement, and the log says which one happened.
    private func preferEchoCancelledInput(_ session: AVAudioSession, when: String) {
        let available = session.isEchoCancelledInputAvailable
        do {
            try session.setPrefersEchoCancelledInput(true)
            NSLog("RP-DICT echoCancelledInput asked=%@ available=%d", when, available ? 1 : 0)
        } catch {
            NSLog(
                "RP-DICT echoCancelledInput refused=%@ available=%d: %@",
                when, available ? 1 : 0, DictationError.describe(error))
        }
    }

    // MARK: - Engine

    private func startLocked(_ engine: AVAudioEngine) throws {
        do {
            try engine.start()
        } catch {
            // 561145187 is '!rec': iOS has refused to start recording since 12.4
            // unless the app is in the foreground (docs/33).
            let ns = error as NSError
            let hint =
                ns.code == 561145187
                ? " Reading Partner has to be on screen to dictate." : ""
            throw DictationError(
                "The microphone would not start: \(DictationError.describe(error)).\(hint)")
        }

        // start() can return without an error and leave the engine stopped: a
        // graph whose formats disagree with the hardware is reconfigured out
        // from under it on the way up. That silence was once reported as a
        // healthy 45-second run (docs/pitfall/132).
        guard engine.isRunning else {
            throw DictationError(
                "The microphone stopped as it started. The output chain accepts "
                    + "\(describeFormat(engine.outputNode.inputFormat(forBus: 0))) while its "
                    + "hardware is \(describeFormat(engine.outputNode.outputFormat(forBus: 0))) "
                    + "and the session runs at \(AVAudioSession.sharedInstance().sampleRate) Hz.")
        }
    }

    /// Back to nothing: no tap, no engine, no active session. Called with `lock`
    /// held.
    private func teardownLocked() {
        setSink(nil)
        stage = .off
        if let engine = engine {
            if tapInstalled {
                engine.inputNode.removeTap(onBus: 0)
            }
            if engine.isRunning {
                engine.stop()
            }
        }
        tapInstalled = false
        self.engine = nil
        format = nil
        openProfile = nil
        if sessionActive {
            do {
                try AVAudioSession.sharedInstance().setActive(
                    false, options: [.notifyOthersOnDeactivation])
            } catch {
                NSLog("RP-DICT deactivate failed: %@", DictationError.describe(error))
            }
            sessionActive = false
        }
    }

    // MARK: - The audio thread

    private func setSink(_ value: ((AVAudioPCMBuffer) -> Void)?) {
        sinkLock.lock()
        sink = value
        sinkLock.unlock()
    }

    /// The tap, and the only thing the audio thread runs. The lock is held for a
    /// pointer read and released before the call, so nothing on this thread can
    /// be waiting on the audio stack while the audio stack waits on it.
    private func deliver(_ buffer: AVAudioPCMBuffer) {
        sinkLock.lock()
        let target = sink
        sinkLock.unlock()
        target?(buffer)
    }
}
