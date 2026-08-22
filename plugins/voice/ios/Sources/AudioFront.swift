// The microphone itself, held apart from the hold that listens to it.
//
// Its lifetime is one voice mode, not one press. The first hold of a voice mode
// builds the session, the voice-processing IO unit, the engine and the tap; the
// holds after it inherit all four. Measured on an iPhone 16 running iOS 26.6,
// 28 holds: press to first audio buffer is 1082 ms (490-1277) when the stack is
// rebuilt every time and 304 ms (120-316) when it is inherited, and the head of
// a short sentence survives 9 times out of 9 on the second number against 2 out
// of 13 on the first. The rebuild is `setVoiceProcessingEnabled(true)` plus the
// `engine.start()` on the unit it rebuilds; reading the hardware format is not
// part of it (0-12 ms in every hold).
//
// What is kept between holds is kept with `pause()`, never `stop()`: Apple
// documents `stop()` as releasing the resources `prepare()` allocated, which is
// the rebuild the next press would then pay for again. The tap stays installed
// with nothing behind it and its buffers are dropped at a nil sink.
//
// The cost is the orange indicator. It lights at `engine.start()` and not at
// `setActive(true)` (docs/pitfall/167), so it is lit for as long as the engine
// is kept — from the user's first word to the moment they leave voice mode.
// That is why nothing here warms the engine up on the way into voice mode, and
// why `close()` exists and is called the instant voice mode ends: the indicator
// has to go out with it.
//
// Nothing releases the engine for idleness. A user who stops to think, to read
// an answer, or to scroll comes back to an inherited microphone; an idle timer
// would make exactly that pause the most expensive thing they can do.
//
// iOS takes the microphone back on its own, and the window in which it can do so
// is now the whole voice mode rather than one press. Three notifications below
// answer for that: an interruption beginning, an input route that went empty,
// and the app leaving the screen — which is the one a locked screen gives,
// because a locked screen backgrounds the app without ever posting an
// interruption (docs/pitfall/162). Parked, any of them tears the stack down and
// the next press rebuilds. Mid-hold, they only refuse the keep: the run owns its
// own teardown, and what would be kept is exactly what just broke.
//
// One rule this file enforces rather than describes: the indicator probe below
// and a hold cannot share a run. Every probe call, `off` included, tears the
// whole stack down on its way in, so the first hold after one is refused — the
// stack goes back to nothing, the refusal says so, and the hold after that is a
// clean cold start. It used to serve that hold instead, paying for the probe's
// teardown inside it, and a round of twenty-one holds went in the bin: the bill
// landed on the `session` step and nothing in the record said so
// (docs/pitfall/168).
//
// Locks: `lock` guards the state machine below and is the one held across calls
// into AVAudioEngine. `sinkLock` guards a single closure reference and is the
// only lock the tap callback takes. They are always taken in that order and
// never the other way round, which is what keeps `engine.pause()` — a call that
// waits for the audio thread to come to rest — from waiting on a tap callback
// that is itself waiting for the lock the pauser holds. The notification
// handlers take `lock` on a queue of their own, never on the thread the
// notification arrived on and never on the main one, so a teardown that takes
// half a second cannot land in the middle of a frame.

import AVFoundation
import Foundation
import UIKit

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
/// The line is a debug build's only. The numbers themselves are not: they go to
/// the webview on every build through DictationTiming, which is what the bench
/// reads and writes to the device. A shipping build has nothing to say to the
/// system log about how long a press took.
///
/// Returns what it printed, so that TimingLog can keep the same number without
/// reading the clock a second time and disagreeing with the log by a hair. The
/// result is not discardable: a step worth a line is a step worth keeping, and
/// the compiler asking about it is how the two roads stay in step.
func markStep(_ step: String, since start: CFAbsoluteTime) -> Double {
    let ms = (CFAbsoluteTimeGetCurrent() - start) * 1000
    #if DEBUG
        NSLog("RP-DICT %@ +%.0fms", step, ms)
    #endif
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
    /// whole point of keeping one is that something outlives the press.
    static let shared = AudioFront()

    /// What `open` hands back: the engine, which the caller watches for
    /// reconfiguration and re-reads the input format from once the recogniser is
    /// up, and the format the tap was installed with. Whether this press paid
    /// for the build or inherited it is in the timing, not here — nothing in a
    /// run behaves differently for it.
    struct Opened {
        let engine: AVAudioEngine
        let format: AVAudioFormat
    }

    private let lock = NSLock()
    private var engine: AVAudioEngine?
    private var format: AVAudioFormat?
    private var tapInstalled = false
    private var sessionActive = false
    private var stage: IndicatorStage = .off

    /// True between `open` and `release`: a run has the microphone right now and
    /// owns its teardown. What the notification handlers may do depends on it.
    private var holding = false
    /// Set when one of them fired while a run had the microphone. The release
    /// then tears down whatever the run asked for, because what it wanted kept is
    /// the thing that broke.
    private var lostDuringHold = false

    /// Whether anything has asked for a probe in this process. `off` and "never
    /// probed" leave the same state behind and are not the same fact about a
    /// press: one of them means somebody parked the microphone and put it back.
    private var probeEverSet = false
    /// Whether a probe has been in the audio stack since the last hold — which
    /// is the question a press has to ask, and it is not "is one parked now".
    /// Every `setIndicatorProbe` call tears the stack down on its way in,
    /// including the one that asks for `off`, so the button that puts the probe
    /// away is itself the thing that destroys a kept engine. A press that
    /// checked the parked stage would let that one through and report a cold
    /// build as the third hold of a run (docs/pitfall/168).
    private var probeTouchedSinceHold = false

    /// The one thing the audio thread reads. Guarded by its own lock and never
    /// called while that lock is held.
    private let sinkLock = NSLock()
    private var sink: ((AVAudioPCMBuffer) -> Void)?

    /// The probe's own tally, so a stage that is supposed to be consuming audio
    /// can be seen to be consuming it. Counts and a level, never content.
    private var probeBuffers = 0
    private var probeLevel: Float = 0

    /// Where the notifications are answered. Never the main queue: the answer to
    /// one of them is a teardown, and a teardown's `setActive(false)` is worth
    /// hundreds of milliseconds.
    private let lifecycleQueue = DispatchQueue(label: "com.readingpartner.voice.lifecycle")
    /// Kept because the call hands them back and they are never given up: this
    /// object is the process's, and so is what it subscribes to.
    private var lifecycleObservers: [NSObjectProtocol] = []

    private init() {
        observeLifecycle()
    }

    // MARK: - A hold

    /// Opens the microphone and points it at `sink`.
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
        pressedAt: CFAbsoluteTime,
        timing: TimingLog,
        sink: @escaping (AVAudioPCMBuffer) -> Void
    ) throws -> Opened {
        lock.lock()
        defer { lock.unlock() }

        // Where the probe was standing when the finger went down and whether it
        // has been in here at all since the last hold, both recorded whatever
        // happens next. A press whose numbers cannot be checked against them
        // afterwards is a press nobody can trust.
        timing.recordProbeStage(probeStageNameLocked(), touched: probeTouchedSinceHold)

        // A probe and a hold cannot share a run. Not merely the microphone: any
        // probe call tears the whole stack down on its way in, so a run of holds
        // that a probe happened in the middle of is two runs with a gap, and the
        // hold after the gap is a cold build wearing the number of a warm one.
        // Serving it anyway is what put a round of twenty-one holds in the bin
        // (docs/pitfall/168).
        //
        // The refusal costs exactly one press: the stack goes back to nothing
        // here, and the flag clears, so the press after this one is a clean cold
        // start and every press after that is an ordinary one. Doing that
        // teardown inside a press that is *served* is the trap — the bill lands
        // on its `session` step and the row looks normal.
        if probeTouchedSinceHold {
            NSLog(
                "RP-DICT front refused a hold: the probe has had the stack since the last one "
                    + "(now %@)", stage.rawValue)
            teardownLocked()
            probeTouchedSinceHold = false
            throw DictationError(
                "The indicator probe has had the microphone since the last hold, so this one "
                    + "was refused and the audio stack put back to nothing. The holds before it "
                    + "are not a run any more — start over from the next hold.")
        }

        lostDuringHold = false
        if let reused = reuseLocked(pressedAt: pressedAt, timing: timing, sink: sink) {
            holding = true
            return reused
        }
        let opened = try openFreshLocked(pressedAt: pressedAt, timing: timing, sink: sink)
        holding = true
        return opened
    }

    /// The fast path: an engine from a previous press, still built, still voice-
    /// processed, still tapped. Returns nil when there is nothing to reuse or
    /// when what there is cannot be trusted, and the caller then pays for a
    /// fresh one — every reason is recorded, because a voice mode that quietly
    /// rebuilt every time would read as "reuse does not help".
    private func reuseLocked(
        pressedAt: CFAbsoluteTime,
        timing: TimingLog,
        sink: @escaping (AVAudioPCMBuffer) -> Void
    ) -> Opened? {
        guard let engine = engine, let format = format, tapInstalled, sessionActive else {
            timing.recordReuseSkipped("nothing was standing to reuse")
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
        // these four are what the press inherited and not what it paid for.
        // What restarting a paused engine costs then stands on its own, as
        // `capturing` minus `microphoneFormat`.
        timing.mark("session", since: pressedAt)
        timing.mark("inputNode", since: pressedAt)
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

        timing.recordReuse(true)
        NSLog("RP-DICT front reused")
        return Opened(engine: engine, format: format)
    }

    /// The slow path, which the first hold of a voice mode takes. This is the
    /// sequence the timings above were measured on, and the order is load-
    /// bearing: voice processing before any format is read, the format read
    /// before the tap, the tap before `prepare()`, and `mainMixerNode` touched
    /// by nobody (docs/pitfall/133).
    private func openFreshLocked(
        pressedAt: CFAbsoluteTime,
        timing: TimingLog,
        sink: @escaping (AVAudioPCMBuffer) -> Void
    ) throws -> Opened {
        teardownLocked()

        try configureSessionLocked()
        timing.mark("session", since: pressedAt)

        let engine = AVAudioEngine()
        self.engine = engine
        // The first read of `inputNode` is where the input audio unit is
        // instantiated and the hardware asked about itself. It gets its own mark
        // so that `voiceProcessing` means one line and this means the other.
        let input = engine.inputNode
        timing.mark("inputNode", since: pressedAt)

        do {
            try input.setVoiceProcessingEnabled(true)
        } catch {
            throw DictationError(
                "The microphone could not be prepared: \(DictationError.describe(error))")
        }
        timing.mark("voiceProcessing", since: pressedAt)

        // Read after the session is active and voice processing is on: both
        // change what the input node reports. This one read is the format the tap
        // is installed with, the format the pre-roll holds, and later the
        // converter's input side. It is not where the time goes: 0-12 ms in
        // every hold ever measured. The line above it and `startLocked` below it
        // are what a cold press pays for.
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
        timing.recordReuse(false)
        NSLog("RP-DICT front built")
        return Opened(engine: engine, format: hardwareFormat)
    }

    /// Lets go of the microphone at the end of a hold, and keeps it standing for
    /// the next one.
    ///
    /// `keep` is the caller's judgement about its own run: a run whose session
    /// was interrupted or whose route went away says no, because what would be
    /// kept is exactly the thing that just broke. This object overrules it in one
    /// direction only — never into keeping something a notification said was
    /// gone.
    func release(keep: Bool) {
        lock.lock()
        defer { lock.unlock() }

        holding = false
        setSink(nil)
        let lost = lostDuringHold
        lostDuringHold = false
        guard keep, !lost, let engine = engine else {
            teardownLocked()
            return
        }
        // pause(), never stop(): Apple documents stop() as releasing what
        // prepare() allocated, which is the rebuild the next press would then
        // pay for again. The tap stays installed with nothing behind it; buffers
        // that arrive before the next press find a nil sink and are dropped.
        engine.pause()
        NSLog("RP-DICT front paused session=active")
    }

    /// Voice mode is over. Everything goes, now — the orange indicator has been
    /// lit since the user's first word and it has to go out with the bar that
    /// explained it. Safe to call with nothing standing, and safe to call twice.
    func close() {
        lock.lock()
        defer { lock.unlock() }

        holding = false
        lostDuringHold = false
        guard engine != nil || sessionActive else { return }
        NSLog("RP-DICT front closed")
        teardownLocked()
    }

    // MARK: - What iOS takes back

    /// The three ways the microphone stops being ours without anybody pressing
    /// anything. Registered once, for the life of the process: the stack they
    /// answer for now outlives every run, so a per-run subscription would leave
    /// the parked window uncovered — which is the window that got longer.
    private func observeLifecycle() {
        let center = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()

        lifecycleObservers.append(
            center.addObserver(
                forName: AVAudioSession.interruptionNotification, object: session, queue: nil
            ) { [weak self] note in
                guard
                    let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                    let type = AVAudioSession.InterruptionType(rawValue: raw),
                    type == .began
                else { return }
                // Only `.began` is acted on. Nothing here resumes on `.ended`:
                // iOS refuses to start recording from the background (docs/33),
                // and a press is what the next microphone waits for.
                self?.lose("an interruption began")
            })

        lifecycleObservers.append(
            center.addObserver(
                forName: AVAudioSession.routeChangeNotification, object: session, queue: nil
            ) { [weak self] _ in
                self?.loseIfInputRouteWentAway()
            })

        // A locked screen backgrounds the app and takes the input route with it
        // without ever posting an interruption (docs/pitfall/162). It is also
        // the app switcher, and either way a kept engine is about to be one iOS
        // has stopped feeding — with the indicator still lit over it.
        lifecycleObservers.append(
            center.addObserver(
                forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil
            ) { [weak self] _ in
                self?.lose("the app left the screen")
            })
    }

    private func lose(_ why: String) {
        lifecycleQueue.async { [weak self] in
            guard let self = self else { return }
            self.lock.lock()
            defer { self.lock.unlock() }
            self.loseLocked(why)
        }
    }

    /// An empty input route is the microphone going away, and on a locked screen
    /// it is the only notice given (docs/pitfall/162).
    ///
    /// The route is re-read here rather than taken from the notification: it also
    /// changes on the way in, while the session is being configured, and it is
    /// legitimately empty for part of that. By the time this runs, whoever was
    /// building has finished and the route is whatever it settled on.
    private func loseIfInputRouteWentAway() {
        lifecycleQueue.async { [weak self] in
            guard let self = self else { return }
            self.lock.lock()
            defer { self.lock.unlock() }
            guard AVAudioSession.sharedInstance().currentRoute.inputs.isEmpty else { return }
            self.loseLocked("the input route went away")
        }
    }

    private func loseLocked(_ why: String) {
        if holding {
            // A run has the microphone and owns its own teardown — it hears the
            // same interruption and the same route change and stops itself. All
            // this may do is refuse the keep, so the release that follows does
            // not park something iOS has already taken.
            guard !lostDuringHold else { return }
            lostDuringHold = true
            NSLog("RP-DICT front will not keep this hold's microphone: %@", why)
            return
        }
        guard engine != nil || sessionActive else { return }
        NSLog("RP-DICT front let a parked microphone go: %@", why)
        teardownLocked()
    }

    // MARK: - The indicator probe

    /// Stops the audio stack at one step and stays there until something else
    /// is asked for. Nothing is transcribed, nothing is emitted and no audio is
    /// kept; the answer comes from the status bar of the phone in someone's
    /// hand.
    ///
    /// Always torn down first, so each stage is entered from nothing and the
    /// indicator's state is the state of that stage and not of its predecessor.
    /// Configured the way a hold configures itself — `.playAndRecord`,
    /// `.voiceChat`, voice processing on — because the question is about what
    /// this app does, not about what is cheapest.
    func setIndicatorProbe(_ wanted: IndicatorStage) throws -> IndicatorProbeState {
        lock.lock()
        defer { lock.unlock() }

        teardownLocked()
        holding = false
        lostDuringHold = false
        // Both set before the early return below, so that asking for `off`
        // counts. That call tears the stack down like every other one, which is
        // exactly why "put it back on Off" cannot be what a press waits for: the
        // engine a voice mode was keeping is gone by then either way.
        probeEverSet = true
        probeTouchedSinceHold = true
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
            try configureSessionLocked()
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

    /// `.voiceChat` is the mode the voice-processing unit wants, and it sets HFP
    /// itself, so no Bluetooth option here. `.defaultToSpeaker` is what puts
    /// playback on the speaker, which is the echo the unit is there to cancel.
    private func configureSessionLocked() throws {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker])
        } catch {
            throw DictationError(
                "The microphone is in use by something else: \(DictationError.describe(error))")
        }

        do {
            try session.setActive(true)
        } catch {
            throw DictationError(
                "The microphone is in use by something else: \(DictationError.describe(error))")
        }
        sessionActive = true
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
