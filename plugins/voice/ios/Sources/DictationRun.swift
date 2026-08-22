// One hold of the dictation bar: microphone in, transcript events out, and the
// whole transcript back at the end.
//
// The chain, in the order start() builds it (docs/33, ASR and AEC 与音频路由):
//
//   AudioFront                                   the session, the engine and the
//                                                tap, which outlive this object
//                                                on the profiles that reuse
//                                                them; it is also where the
//                                                echo canceller is chosen
//   tap -> AVAudioConverter                      SpeechAnalyzer does no audio
//                                                conversion of its own; the
//                                                format it wants comes from
//                                                bestAvailableAudioFormat, and
//                                                on iOS 26 the 48k -> 16k step
//                                                cannot be skipped
//   AsyncStream<AnalyzerInput> -> SpeechAnalyzer
//   SpeechTranscriber.results                    an AsyncSequence of
//                                                AttributedString results
//
// Order matters more than the drawing suggests, and the ordering that matters
// most is in AudioFront.swift: setVoiceProcessingEnabled rebuilds the IO unit,
// and a rebuilt unit answers questions about the hardware with AVAudioEngine's
// defaults — 44100 Hz stereo — until the engine has been prepared. Every format
// used here is one the engine reported, never one this file chose, and the
// format the tap is installed with is checked again before a converter is built
// from it.
//
// start() builds that chain in two halves, and the split is the point of the
// ordering. The first half is only what an open microphone needs — permission,
// session, voice processing, tap, engine — and it is short. The second half is
// the recogniser: the locale, its model, the format it accepts, the analyzer.
// Audio arriving between the two goes into the pre-roll and is handed over in
// order once the analyzer is consuming, so the stream the recogniser sees
// starts at the press rather than at its own readiness. Two holds in eleven
// lost their first syllable before this, and both were short ones: the same
// Chinese sentence came back whole at 2.6 seconds and headless at 2.4.
//
// A run is single-use. Once stopped, or once the audio session is interrupted,
// it is dead: iOS refuses to restart recording from the background (docs/33),
// so nothing here tries. Its transcript outlives the capture, though — an
// interruption or the backstop tears the microphone down and keeps the words,
// so the stop_dictation that follows still has something to answer with.

import AVFoundation
// UnsafeMutableAudioBufferListPointer, which the pre-roll's copy walks: it
// belongs to the CoreAudio overlay, not to AVFoundation.
import CoreAudio
import CoreMedia
import Foundation
import Speech
import Tauri

/// A failure carrying a sentence the composer can show, instead of a stack
/// trace. Every rejection this plugin makes is rendered raw under the bar.
struct DictationError: Error {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    static func describe(_ error: Error) -> String {
        if let dictation = error as? DictationError { return dictation.message }
        let ns = error as NSError
        return "\(ns.domain) \(ns.code): \(ns.localizedDescription)"
    }
}

/// A one-shot latch that can be waited on with a deadline. Swift has no way to
/// abandon an `await` on another task's completion — cancelling the waiter does
/// not return it — so the deadline resolves the wait instead of racing it: a
/// timer signals the same latch, and whoever gets there first wakes everybody.
private final class Gate {
    private let lock = NSLock()
    private var opened = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func signal() {
        lock.lock()
        opened = true
        let pending = waiters
        waiters = []
        lock.unlock()
        for waiter in pending { waiter.resume() }
    }

    func wait(upToMs: UInt64, onTimeout: (() -> Void)? = nil) async {
        lock.lock()
        let already = opened
        lock.unlock()
        if already { return }

        let timer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: upToMs * 1_000_000)
            if Task.isCancelled { return }
            onTimeout?()
            self?.signal()
        }
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            lock.lock()
            if opened {
                lock.unlock()
                continuation.resume()
                return
            }
            waiters.append(continuation)
            lock.unlock()
        }
        timer.cancel()
    }
}

final class DictationRun {
    /// One event, three shapes: `{kind:"volatile"|"final",text}` and
    /// `{kind:"level",value}`. The webview's reducer has no default branch, so
    /// a further kind leaves it holding `undefined` and the next event throws
    /// inside a callback nothing catches — which is why the fourth one,
    /// `{kind:"timing",timing}`, arrived in the reducer as a case of its own
    /// before the plugin was allowed to send it. It does not come through here:
    /// the plugin sends it once the run is down (VoicePlugin.emitTiming).
    typealias Emit = (JSObject) -> Void

    private let emit: Emit

    /// Which front end this hold runs on. Chosen per press by the caller and
    /// carried here only to be handed to AudioFront and logged; `current` is
    /// what everything that does not ask gets.
    private let profile: AudioProfile

    /// Every step of this hold, gathered as it happens and handed to the plugin
    /// when the hold is over (DictationTiming.swift). The `RP-DICT` lines are
    /// unchanged and still the primary record; this is the copy that reaches the
    /// device's own file, because a syslog stream is a thing that stops without
    /// saying so.
    private let timing = TimingLog()

    private var transcriber: SpeechTranscriber?
    private var analyzer: SpeechAnalyzer?
    private var resultsTask: Task<Void, Never>?

    // Written once during start(), then read from the tap callback on the audio
    // thread. Never cleared: tearing them down while a tap callback might still
    // be in flight buys nothing, and the whole run is released together.
    private var converter: AVAudioConverter?
    private var analyzerFormat: AVAudioFormat?
    private var inputContinuation: AsyncStream<AnalyzerInput>.Continuation?

    private var notificationObservers: [NSObjectProtocol] = []

    /// True from the moment the tap is running until the teardown. The route
    /// changes on the way in too, while the session is being configured, and
    /// empty inputs are legitimate for part of that.
    private var capturing = false

    // MARK: - Pre-roll

    /// The audio the microphone heard before the recogniser could take it.
    ///
    /// Raw tap buffers in the microphone's own format, not converted ones.
    /// Buffering converted audio would need the converter before the recogniser
    /// is ready, and the converter's output format comes from
    /// `bestAvailableAudioFormat` — asked after the model install, which is the
    /// longest step there is. Whether that ask survives being moved in front of
    /// the install is untested, and it is untested in exactly the case where the
    /// pre-roll matters most. Raw costs a copy per buffer and 48 kHz instead of
    /// 16 kHz in memory; the cap keeps both small.
    ///
    /// A release that lands before start() returns is unchanged by any of this.
    /// The composer's machine goes arming -> aborting and sends
    /// cancel_dictation; the run is torn down and the queue is dropped unread.
    /// start() still returns at the same point it always did, so that window is
    /// neither longer nor shorter than before and the bench's "released before
    /// the recognizer came up" still means the words were never transcribed.
    /// What changed is why: the microphone was open and did hear them. They are
    /// discarded here, having reached neither the analyzer nor anything that
    /// leaves the device.
    private let prerollLock = NSLock()
    private var preroll: [AVAudioPCMBuffer] = []
    private var prerollFrames: AVAudioFrameCount = 0
    private var prerollDropped: AVAudioFrameCount = 0
    private var prerollCapFrames: AVAudioFrameCount = 0
    private var tapSampleRate: Double = 0
    /// A copy that failed repeats on every buffer; one line says it.
    private var loggedPrerollCopyFailure = false

    /// True from the tap's first callback until the hand-over has emptied the
    /// queue. While it is true every buffer goes to the queue, so a live buffer
    /// cannot overtake the ones still queued ahead of it; it is cleared only
    /// with the queue empty and the lock held. That is what makes the handover
    /// free of both gaps and overlap, and it is also what keeps `feed` single-
    /// threaded: the tap does not reach it while a hand-over is in progress, and
    /// AVAudioConverter carries resampler state a second caller would corrupt.
    private var buffering = true

    /// How much audio the pre-roll keeps. Five seconds is about ten times the
    /// gap it exists for, and the drop is from the front, so a longer wait keeps
    /// the five seconds next to the moment recognition actually begins rather
    /// than the five oldest.
    ///
    /// It is deliberately not sized for the other wait. A language whose model
    /// is not on the device yet stalls in a download measured in minutes, not
    /// seconds (docs/pitfall/158): no cap rescues that hold, and splicing the
    /// syllable someone said minutes ago onto what they say once a recogniser
    /// finally exists would be worse than losing it. Dropping the oldest leaves
    /// that case exactly where it was.
    ///
    /// Five seconds of 48 kHz mono float32 is 960 KB, and it is freed with the
    /// run.
    private static let prerollSeconds: Double = 5

    private var stopping = false
    /// Set when the session was interrupted, the route went away, or the front
    /// end never came up. A hold that ends this way never lets the front end
    /// keep anything for the next one: what would be kept is what just broke.
    private var sessionBroken = false
    private let stopLock = NSLock()

    // MARK: - Transcript

    // The webview folds the event stream the same way (applyDictationEvent):
    // finals in order, one replaceable tail. stop_dictation's answer does not
    // pass through that fold, so this side has to produce the identical string.
    private let transcriptLock = NSLock()
    private var finals: [String] = []
    private var volatileTail = ""

    // MARK: - Emission

    // Nothing may leave before start_dictation's response reaches the webview
    // (the hold sits in `arming` and drops early events) and nothing may leave
    // after stop_dictation is received (the listener stays registered through
    // the flush, and a late event lands twice in the next hold). The
    // accumulator above keeps working either way; only this gate closes.
    private let emitLock = NSLock()
    private var emitting = false

    // MARK: - Failure

    // There is no error kind in the event payload, so a recogniser that dies at
    // second 1 of a 30-second hold cannot say so until the finger lifts. The
    // reason is held here and rejected out of stop_dictation.
    private let failureLock = NSLock()
    private var failure: String?

    // MARK: - Level

    /// A ceiling, not a rate. The tap decides the real one, and it comes out at
    /// a measured 9.6-10.0 Hz over twelve holds — inside the 10-20 Hz the
    /// meter's 75 ms CSS transition wants, so the buffer stays big and this
    /// stays a guard against a smaller one.
    ///
    /// Which buffer size produces that is not settled: the 4096 frames asked for
    /// below would be 85 ms and 11.7 Hz, and 4800 (100 ms, exactly 10 Hz) fits
    /// every hold length better. bufferSize is a request, not a contract, so
    /// consume() logs the delivered frame count on the first buffer rather than
    /// arguing from the requested one (docs/pitfall/161).
    private static let levelInterval: CFAbsoluteTime = 1.0 / 15.0
    private var lastLevelAt: CFAbsoluteTime = 0
    /// Linear RMS mapped to 0..1 across this window. VPIO's AGC moves near-voice
    /// level by ~18 dB (docs/33), so the floor is well below a quiet room.
    ///
    /// Measured, and kept. Eleven hand-held holds by one person at 0.5-0.8 m in
    /// a quiet empty room, 752 level samples: silence between phrases sits at
    /// -85 to -90 dB, median speech at -22 to -26 dB, per-hold p90 at -16 to
    /// -21 dB, loudest single sample -11.3 dB.
    ///
    /// Through this window that is 0.00 for silence, 0.59-0.70 for median
    /// speech, 0.73-0.85 at p90 and 0.79-0.97 at the peak — alive across most
    /// of the bar with nothing clipping. -10 sits 1.2 dB above the loudest
    /// sample seen, which is the headroom a closer hold needs: hold-to-talk
    /// puts the phone in a hand, and 0.3 m would add about 6 dB. Fitting the
    /// top to the median peak instead would peg the meter for every word at
    /// that distance and stop it carrying information.
    ///
    /// The spread across holds is 4.3 dB at the median and 7.2 dB at the peak,
    /// and it is not the arm moving: the Chinese holds are the loud end
    /// (peaks -11 to -15) and the English ones the quiet end (-15 to -18)
    /// throughout. -10 is set against the loud end deliberately.
    ///
    /// All of it was measured with voice processing on, whose automatic gain is
    /// worth 18 dB on near-voice (docs/33). The profiles that run without it
    /// (AudioProfile.echoCancelledInput) therefore read low through this window:
    /// on 2026-08-22, twenty holds on one iPhone 16, the loudest sample of a
    /// hold came back 4.2 dB quieter with the unit off — -19.0 dB against
    /// -23.2 dB, ten holds averaged on each side. That is a peak, while the
    /// 18 dB above is a mean of near-voice level; an earlier note here quoted
    /// 17 dB from another phone on iOS 18.7 and read the two as the same
    /// quantity. A peak from one profile and a peak from another are still not
    /// comparable, and the bench's peak column is a within-profile number.
    private static let quietDb: Float = -50
    private static let loudDb: Float = -10

    private let startedAt = CFAbsoluteTimeGetCurrent()
    /// A conversion failure repeats on every buffer; one line says it.
    private var loggedConversionFailure = false
    /// Press-to-first-buffer is the number hold-to-talk lives or dies on, and
    /// the tap is the only place that knows it happened. With the pre-roll in
    /// front of the recogniser this is now the whole of the head loss: audio
    /// older than the first buffer predates the microphone and no buffer can
    /// hold it.
    private var firstBufferAt: CFAbsoluteTime = 0
    private var pressedAt: CFAbsoluteTime = 0

    /// Volatile results arrive in bursts — six of them inside one millisecond,
    /// each a longer prefix of the same guess. Nothing displays them (the bar
    /// deliberately shows no live text), so their only reader is the timeout
    /// fallback, and every one costs an IPC message and a React state update in
    /// a WKWebView that is also running recognition. The accumulator still takes
    /// every one; only the emission is thinned.
    private static let volatileInterval: CFAbsoluteTime = 0.1
    private var lastVolatileAt: CFAbsoluteTime = 0

    // MARK: - Backstop

    /// A hold nobody released. The webview has no duration cap at all and the
    /// desktop recorder's 90-second backstop has no counterpart here, so the
    /// capture is torn down and the words are kept.
    private static let backstopSeconds: UInt64 = 300
    private var backstopTask: Task<Void, Never>?

    /// How long stop() waits for the results task to deliver the last final
    /// after the analyzer has finalized. Bounded so a stuck stream cannot hold
    /// the next hold's start behind it.
    private static let resultsGraceMs: UInt64 = 500
    private let resultsGate = Gate()

    /// How long stop() waits for finalizeAndFinishThroughEndOfInput(). Measured
    /// at 76-276 ms over eleven human-voice holds (median 104 ms) — and at 89
    /// seconds once, on a session another instance of the app had taken the
    /// microphone from. The three commands run on one serial chain, so an
    /// unbounded wait here does not just delay one answer: it parks every hold
    /// after it, including the one the user makes after the composer gives up
    /// on the flush at FINISH_TIMEOUT_MS and lets them press again.
    ///
    /// Left generous on purpose. This is an anti-wedge net for a state that
    /// should not happen with one app instance, not a latency budget: tightening
    /// it towards the measured 276 ms would start truncating healthy long
    /// flushes, and the thing a truncated flush loses is the last final — which
    /// is emitted to nobody, because the emission gate closes when
    /// stop_dictation arrives.
    private static let finalizeGraceMs: UInt64 = 2000

    init(profile: AudioProfile, emit: @escaping Emit) {
        self.profile = profile
        self.emit = emit
    }

    // MARK: - Start

    /// Builds and starts the whole chain. Returns once the microphone is open
    /// and the analyzer is consuming; the caller resolves the invoke and only
    /// then opens the emission gate.
    func start(locale requested: String?, contextualStrings: [String]) async throws {
        NSLog(
            "RP-DICT start locale=%@ contextualStrings=%d",
            requested ?? "auto", contextualStrings.count)
        let t0 = CFAbsoluteTimeGetCurrent()
        pressedAt = t0

        // False on the simulator (no Neural Engine to simulate) and on hardware
        // Apple considers too small. Neither is recoverable.
        guard SpeechTranscriber.isAvailable else {
            throw DictationError(
                "This iPhone cannot transcribe on device. It needs iOS 26 on an iPhone 12 or later.")
        }

        try await ensureMicrophonePermission()
        mark("permission", since: t0)

        // --- the microphone half ---------------------------------------------
        //
        // Nothing here asks the recogniser anything. The whole point is to get
        // the tap running, because head loss inside this half is the only kind
        // left: audio older than the first buffer predates the microphone and
        // the pre-roll cannot hold what was never captured.

        // Subscribed before the microphone opens, not after: an interruption
        // that lands while the session is being configured is one this run has
        // to hear, and the handlers guard on `capturing` for the part of that
        // window where an empty input route is normal.
        observeSessionNotifications()

        let opened: AudioFront.Opened
        do {
            opened = try AudioFront.shared.open(
                profile: profile, pressedAt: t0, timing: timing
            ) { [weak self] buffer in
                self?.consume(buffer)
            }
        } catch {
            // Half a front end is not something the next hold may inherit.
            markSessionBroken()
            throw error
        }
        // The engine belongs to the front end, which on a reusing profile keeps
        // it after this run is gone. What this run needs it for is two reads:
        // the input node's format, once the recogniser is up, and the
        // reconfiguration notice.
        let input = opened.engine.inputNode
        let hardwareFormat = opened.format
        observeEngineNotifications(opened.engine)

        tapSampleRate = hardwareFormat.sampleRate
        prerollCapFrames = AVAudioFrameCount(hardwareFormat.sampleRate * Self.prerollSeconds)
        capturing = true

        // Armed here rather than at the end: from this line on there is an open
        // microphone, and a recogniser that never comes up would otherwise leave
        // it open with nobody to close it.
        startBackstop()
        mark("capturing", since: t0)

        // --- the recogniser half ---------------------------------------------
        //
        // Everything below runs with the tap already filling the pre-roll, so
        // its cost is paid in buffered audio rather than in lost syllables.

        let locale = try await resolveLocale(requested)
        mark("locale", since: t0)

        let transcriber = makeTranscriber(locale: locale)
        self.transcriber = transcriber

        // The model lives in system storage, outside the app, and the system
        // drops it again after long disuse — so this asks every run rather than
        // assuming (docs/33). A first-ever hold pays a download here, which is
        // the one wait the pre-roll cap does not try to cover.
        try await installModelIfNeeded(for: transcriber, locale: locale)
        mark("model", since: t0)

        let analyzerFormat = try await resolveAnalyzerFormat(for: transcriber)
        self.analyzerFormat = analyzerFormat
        NSLog("RP-DICT analyzer=%@", Self.describe(analyzerFormat))
        mark("analyzerFormat", since: t0)

        // The graph can move while the recogniser comes up. If it did, the tap
        // installed above is no longer being called — a tap whose format
        // disagrees with the node it sits on does not fail, it is simply never
        // called — and the pre-roll holds a format the microphone has stopped
        // speaking. Refuse: a hold that captures nothing is worse than one that
        // never starts.
        let currentFormat = input.outputFormat(forBus: 0)
        guard currentFormat.isEqual(hardwareFormat) else {
            throw DictationError(
                "The microphone changed format while it was being opened, from "
                    + "\(Self.describe(hardwareFormat)) to \(Self.describe(currentFormat)).")
        }
        guard let converter = AVAudioConverter(from: hardwareFormat, to: analyzerFormat) else {
            throw DictationError(
                "No audio converter from \(Self.describe(hardwareFormat)) to "
                    + "\(Self.describe(analyzerFormat)).")
        }
        self.converter = converter

        let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
        inputContinuation = continuation

        let analyzer = SpeechAnalyzer(modules: [transcriber])
        self.analyzer = analyzer

        // Hot words, before prepareToAnalyze. docs/33 measured that these do not
        // cross a language boundary and help only weakly within one, so they are
        // worth passing and not worth failing a start over.
        let hints = Self.capContextualStrings(contextualStrings)
        if !hints.isEmpty {
            let context = AnalysisContext()
            context.contextualStrings = [.general: hints]
            try await analyzer.setContext(context)
        }

        do {
            try await analyzer.prepareToAnalyze(in: analyzerFormat)
        } catch {
            throw DictationError("The recognizer would not start: \(DictationError.describe(error))")
        }
        mark("prepareToAnalyze", since: t0)

        // Consume before feeding, so nothing that arrives early is missed.
        startConsumingResults(from: transcriber)

        do {
            try await analyzer.start(inputSequence: stream)
        } catch {
            throw DictationError("The recognizer would not start: \(DictationError.describe(error))")
        }

        // Last, and only once the analyzer is consuming: everything the
        // microphone heard since the press goes in, in order, and the tap goes
        // live behind it.
        handOverPreroll()
        mark("running", since: t0)
    }

    /// Opens the gate. Called by the plugin after `invoke.resolve()`, never
    /// before: the hold is in `arming` until the response lands and drops every
    /// event that arrives first.
    func beginEmitting() {
        emitLock.lock()
        emitting = true
        emitLock.unlock()
    }

    /// Closes it, before any teardown. The listener stays registered through the
    /// whole flush and a late event would be counted twice in the next hold.
    func endEmitting() {
        emitLock.lock()
        emitting = false
        emitLock.unlock()
    }

    private func send(_ data: JSObject) {
        emitLock.lock()
        let open = emitting
        emitLock.unlock()
        guard open else { return }
        emit(data)
    }

    // MARK: - Stop

    /// Tears the run down: capture, analyzer, audio session. The transcript
    /// survives, so a stop that follows an interruption or the backstop still
    /// has the words. Safe to call twice and safe on a run that never started.
    func stop() async {
        // The lock is taken in a synchronous helper on purpose: taking one
        // directly in an async function blocks a cooperative thread, which the
        // compiler warns about and Swift 6 rejects outright.
        guard claimStop() else { return }
        let t0 = CFAbsoluteTimeGetCurrent()

        for observer in notificationObservers {
            NotificationCenter.default.removeObserver(observer)
        }
        notificationObservers = []

        backstopTask?.cancel()
        backstopTask = nil

        // Back to the front end, which decides between pausing and tearing
        // down. This run only says whether what it had is worth keeping.
        capturing = false
        AudioFront.shared.release(profile: profile, keep: !sessionIsBroken())
        // Measured from the release, not from the press: what this one says is
        // whether letting go is cheaper than tearing down, which is the other
        // half of the question `reuse` is asking.
        markTeardown("released", since: t0)

        dropPreroll()

        // Ending the input sequence is what lets the analyzer finish; finalize
        // then flushes whatever it was still holding as volatile.
        inputContinuation?.finish()
        if let analyzer = analyzer {
            let finalized = Gate()
            Task {
                do {
                    try await analyzer.finalizeAndFinishThroughEndOfInput()
                } catch {
                    self.recordFailure("Dictation stopped unexpectedly.")
                    NSLog("RP-DICT finalize failed: %@", DictationError.describe(error))
                }
                finalized.signal()
            }
            await finalized.wait(upToMs: Self.finalizeGraceMs) {
                NSLog("RP-DICT finalize did not return in %llums", Self.finalizeGraceMs)
            }
        }
        markTeardown("finalized", since: t0)

        // The results task is a separate Task and may still be delivering the
        // last final when finalize returns. Waiting for the stream to end is
        // what makes the accumulator complete; the grace period keeps a stuck
        // stream from holding the next hold's start behind it.
        if resultsTask != nil {
            await resultsGate.wait(upToMs: Self.resultsGraceMs) {
                NSLog("RP-DICT results grace expired")
            }
        }
        resultsTask?.cancel()
        resultsTask = nil
        markTeardown("results", since: t0)
        markTeardown("stopped", since: t0)
    }

    /// Drops whatever the pre-roll is still holding: it is the user's voice and
    /// after a teardown nothing is going to read it. Not left to the release —
    /// a run torn down by the backstop stays in the plugin until the next
    /// stop_dictation arrives, which may be a long time. Synchronous for the
    /// same reason claimStop() is.
    private func dropPreroll() {
        prerollLock.lock()
        preroll = []
        prerollFrames = 0
        prerollLock.unlock()
    }

    /// True for the first caller only. The app's stop, the interruption handler
    /// and the backstop can all decide to end a run, and they must not tear it
    /// down twice.
    private func claimStop() -> Bool {
        stopLock.lock()
        defer { stopLock.unlock() }
        if stopping { return false }
        stopping = true
        return true
    }

    /// Same reason `claimStop()` is synchronous: the flag is written from the
    /// notification handlers on the main queue and read once by the teardown on
    /// the plugin's serial chain, which are different threads.
    private func markSessionBroken() {
        stopLock.lock()
        sessionBroken = true
        stopLock.unlock()
    }

    private func sessionIsBroken() -> Bool {
        stopLock.lock()
        defer { stopLock.unlock() }
        return sessionBroken
    }

    // MARK: - Transcript

    /// The whole thing the user said, spaced exactly the way the webview would
    /// have spaced the same events. A tail that never got a final of its own is
    /// included, which is what the webview's own fold does with it.
    func transcript() -> String {
        transcriptLock.lock()
        let parts = finals + [volatileTail]
        transcriptLock.unlock()
        return parts.reduce("", Self.joinSpeech).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The failure to reject stop_dictation with, if the recognizer died on the
    /// way. Nil on a healthy hold.
    func failureMessage() -> String? {
        failureLock.lock()
        defer { failureLock.unlock() }
        return failure
    }

    private func recordFailure(_ message: String) {
        failureLock.lock()
        if failure == nil { failure = message }
        failureLock.unlock()
    }

    // A space goes into a seam unless a CJK character sits on either side of it.
    // The webview's joinSpeech is the same rule over the same ranges; the two
    // have to agree, because stop_dictation's answer never passes through it.
    private static let cjkRanges: [ClosedRange<UInt32>] = [
        0x2E80...0x303F, 0x3040...0x30FF, 0x3400...0x4DBF,
        0x4E00...0x9FFF, 0xF900...0xFAFF, 0xFE30...0xFE4F, 0xFF00...0xFFEF,
    ]

    private static func isCJK(_ scalar: Unicode.Scalar) -> Bool {
        cjkRanges.contains { $0.contains(scalar.value) }
    }

    static func joinSpeech(_ left: String, _ right: String) -> String {
        if left.isEmpty { return right }
        if right.isEmpty { return left }
        guard let last = left.unicodeScalars.last, let first = right.unicodeScalars.first else {
            return left + right
        }
        let whitespace = CharacterSet.whitespacesAndNewlines
        let seam =
            whitespace.contains(last) || whitespace.contains(first) || isCJK(last) || isCJK(first)
            ? "" : " "
        return left + seam + right
    }

    // MARK: - Locale

    /// Membership in `supportedLocales` is the only test that means anything.
    /// `Locale.current` can carry a region override whose identifier does not
    /// construct, and `supportedLocale(equivalentTo:)` answers with locales that
    /// are not in the list at all (docs/33). Apple's own documentation says to
    /// use the latter; the device says otherwise.
    static func match(_ tag: String, in locales: [Locale]) -> Locale? {
        let wanted = normalise(tag)
        return locales.first { normalise($0.identifier(.bcp47)) == wanted }
    }

    private static func normalise(_ tag: String) -> String {
        tag.replacingOccurrences(of: "_", with: "-").lowercased()
    }

    /// Without a locale from the composer — which is the normal case, the bar
    /// never passes one — walk the device's own preference order and take the
    /// first supported one.
    private func resolveLocale(_ tag: String?) async throws -> Locale {
        let supported = await SpeechTranscriber.supportedLocales

        if let tag = tag {
            guard let locale = Self.match(tag, in: supported) else {
                throw DictationError(
                    "This iPhone cannot dictate in \(tag). Add the language in Settings, or speak "
                        + "one it already knows.")
            }
            return locale
        }

        for preferred in Locale.preferredLanguages {
            if let locale = Self.match(preferred, in: supported) {
                NSLog("RP-DICT locale from preferredLanguages: %@", locale.identifier(.bcp47))
                return locale
            }
        }
        guard let fallback = Self.match("en-US", in: supported) else {
            throw DictationError("This iPhone has no dictation language installed.")
        }
        NSLog("RP-DICT locale fell back to en-US")
        return fallback
    }

    // MARK: - Transcriber and model

    /// Options are fixed rather than parameterised: docs/33 already decided
    /// them. `.audioTimeRange` stays on even though the event drops the numbers,
    /// because barge-in truncation wants it later.
    private func makeTranscriber(locale: Locale) -> SpeechTranscriber {
        SpeechTranscriber(
            locale: locale,
            transcriptionOptions: [],
            reportingOptions: [.volatileResults, .fastResults],
            attributeOptions: [.transcriptionConfidence, .audioTimeRange])
    }

    private func installModelIfNeeded(for transcriber: SpeechTranscriber, locale: Locale) async
        throws
    {
        let request: AssetInstallationRequest?
        do {
            request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber])
        } catch {
            throw DictationError(
                "The dictation model is unavailable: \(DictationError.describe(error))")
        }
        guard let request = request else { return }

        NSLog("RP-DICT downloading the model for %@", locale.identifier(.bcp47))
        let began = CFAbsoluteTimeGetCurrent()
        do {
            try await request.downloadAndInstall()
        } catch {
            throw DictationError(
                "The dictation model could not be downloaded. Check the network and hold again.")
        }
        NSLog(
            "RP-DICT model installed in %.0fms", (CFAbsoluteTimeGetCurrent() - began) * 1000)
    }

    /// Apple's contextual-strings API degrades past about a hundred entries and
    /// the composer sends an uncapped `glossary.split('\n')`. Truncate and say
    /// so; never fail a start over hot words.
    private static func capContextualStrings(_ strings: [String]) -> [String] {
        let cleaned =
            strings
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .map { $0.count > 100 ? String($0.prefix(100)) : $0 }
        if cleaned.count <= 100 { return cleaned }
        NSLog("RP-DICT contextualStrings capped from %d to 100", cleaned.count)
        return Array(cleaned.prefix(100))
    }

    // MARK: - Audio session and formats

    private func resolveAnalyzerFormat(for transcriber: SpeechTranscriber) async throws
        -> AVAudioFormat
    {
        guard let best = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber])
        else {
            throw DictationError("The recognizer would not name an audio format it accepts.")
        }
        return best
    }

    /// The same line AudioFront prints, so a format quoted in an error and a
    /// format quoted in the log can be compared character for character.
    private static func describe(_ format: AVAudioFormat) -> String {
        describeFormat(format)
    }

    // MARK: - Notifications

    /// The session's own notifications. Registered before the microphone opens,
    /// so the window in which the session is being configured is covered too.
    private func observeSessionNotifications() {
        let center = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()

        notificationObservers.append(
            center.addObserver(
                forName: AVAudioSession.interruptionNotification, object: session, queue: .main
            ) { [weak self] note in
                self?.handleInterruption(note)
            })

        notificationObservers.append(
            center.addObserver(
                forName: AVAudioSession.routeChangeNotification, object: session, queue: .main
            ) { [weak self] _ in
                let route = AVAudioSession.sharedInstance().currentRoute
                NSLog(
                    "RP-DICT route in=[%@] out=[%@]",
                    route.inputs.map { $0.portType.rawValue }.joined(separator: ", "),
                    route.outputs.map { $0.portType.rawValue }.joined(separator: ", "))
                guard let self = self else { return }

                // An empty input route is the end of the capture, and it is the
                // only notice given: no interruption fires, the engine still
                // says isRunning, and the tap simply stops being called
                // (docs/pitfall/162). Left unhandled it reads as a hold that
                // heard nothing, which is exactly how a fourteen-second run died
                // on 2026-08-17 with no reason recorded anywhere.
                //
                // Only once capture is really up: the route changes on the way
                // in too, while the session is being configured, and inputs are
                // legitimately empty for part of that.
                guard self.capturing, route.inputs.isEmpty else { return }
                NSLog("RP-DICT the microphone went away mid-hold")
                self.markSessionBroken()
                self.recordFailure(
                    "The microphone became unavailable. Hold again to keep going.")
                self.endEmitting()
                Task { [weak self] in await self?.stop() }
            })
    }

    /// The engine's own notification, which can only be subscribed once there is
    /// an engine. It posts this when the hardware format changes under it, and
    /// it stops itself on the way — the one event that explains a hold which
    /// started without an error and captured nothing. A reused engine is a
    /// reconfiguration risk between holds as well, which is why the front end
    /// re-reads the input format before handing one back.
    private func observeEngineNotifications(_ engine: AVAudioEngine) {
        notificationObservers.append(
            NotificationCenter.default.addObserver(
                forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
            ) { [weak engine] _ in
                NSLog(
                    "RP-DICT the engine reconfigured itself; running=%d",
                    (engine?.isRunning ?? false) ? 1 : 0)
            })
    }

    private func handleInterruption(_ note: Notification) {
        guard
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: raw)
        else { return }

        switch type {
        case .began:
            // Any interruption is the end of the session: restarting the
            // microphone from the background is refused by iOS (docs/33, 后台与
            // 锁屏). The words captured so far are still the user's, so the
            // teardown keeps them and stop_dictation answers with them.
            NSLog("RP-DICT interrupted")
            markSessionBroken()
            endEmitting()
            Task { [weak self] in await self?.stop() }
        case .ended:
            NSLog("RP-DICT interruption ended; not resuming")
        @unknown default:
            break
        }
    }

    /// The hold nobody let go of. Tears the capture down and keeps the words.
    private func startBackstop() {
        backstopTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: Self.backstopSeconds * 1_000_000_000)
            if Task.isCancelled { return }
            guard let self = self else { return }
            NSLog("RP-DICT backstop after %llus", Self.backstopSeconds)
            self.endEmitting()
            await self.stop()
        }
    }

    // MARK: - Audio path

    private func consume(_ buffer: AVAudioPCMBuffer) {
        if firstBufferAt == 0 {
            firstBufferAt = CFAbsoluteTimeGetCurrent()
            // The frame count is here because pitfall 161 argued from 4096 and
            // the arithmetic did not match the measurement: 4096 at 48 kHz
            // predicts 11.7 Hz and twelve holds read 9.6-10.0. installTap's
            // bufferSize is a request, not a contract, and nothing had ever
            // logged what was actually delivered.
            let elapsed = (firstBufferAt - pressedAt) * 1000
            NSLog(
                "RP-DICT firstBuffer +%.0fms frames=%u rate=%.0f",
                elapsed,
                buffer.frameLength,
                buffer.format.sampleRate)
            // Kept rather than marked: the line above carries the frame count
            // and the sample rate too, and pitfall 161 is argued from it.
            timing.record("firstBuffer", ms: elapsed)
        }
        emitLevel(buffer)

        prerollLock.lock()
        if buffering {
            enqueuePreroll(buffer)
            prerollLock.unlock()
            return
        }
        prerollLock.unlock()
        feed(buffer)
    }

    /// Queues one tap buffer, oldest first out when the cap is reached. Called
    /// with `prerollLock` held.
    private func enqueuePreroll(_ buffer: AVAudioPCMBuffer) {
        guard let copy = Self.copyBuffer(buffer) else {
            if !loggedPrerollCopyFailure {
                loggedPrerollCopyFailure = true
                NSLog("RP-DICT the pre-roll could not copy a buffer")
            }
            return
        }
        preroll.append(copy)
        prerollFrames += copy.frameLength
        while prerollFrames > prerollCapFrames, !preroll.isEmpty {
            let oldest = preroll.removeFirst()
            prerollFrames -= oldest.frameLength
            prerollDropped += oldest.frameLength
        }
    }

    /// Hands the queue to the analyzer and puts the tap on the live path. Runs
    /// on the start task, once the analyzer is consuming.
    ///
    /// The loop re-takes the lock every time instead of draining under one hold
    /// of it, so the tap is never blocked for the length of the hand-over; the
    /// buffers it delivers meanwhile join the back of the same queue and go in
    /// behind the ones already there. It terminates because the tap adds one
    /// buffer per ~100 ms and a conversion is microseconds.
    private func handOverPreroll() {
        let began = CFAbsoluteTimeGetCurrent()
        var handed: AVAudioFrameCount = 0
        var buffers = 0
        while true {
            prerollLock.lock()
            guard !preroll.isEmpty else {
                buffering = false
                let dropped = prerollDropped
                prerollLock.unlock()
                let rate = tapSampleRate > 0 ? tapSampleRate : 1
                let heldMs = Double(handed) / rate * 1000
                let droppedMs = Double(dropped) / rate * 1000
                let handoverMs = (CFAbsoluteTimeGetCurrent() - began) * 1000
                NSLog(
                    "RP-DICT preroll %d buffers %.0fms dropped=%.0fms in %.0fms",
                    buffers, heldMs, droppedMs, handoverMs)
                timing.recordPreroll(
                    buffers: buffers, ms: heldMs, droppedMs: droppedMs, handoverMs: handoverMs)
                return
            }
            let next = preroll.removeFirst()
            prerollFrames -= next.frameLength
            prerollLock.unlock()
            handed += next.frameLength
            buffers += 1
            feed(next)
        }
    }

    /// The tap hands out a buffer the audio unit reuses the moment the callback
    /// returns, so anything kept has to be copied. Copied through the buffer
    /// list rather than `floatChannelData`: that accessor is nil for any sample
    /// type but float and reports a single channel for an interleaved format,
    /// and the tap format here is whatever the engine reported, not one this
    /// file chose.
    private static func copyBuffer(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard
            buffer.frameLength > 0,
            let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength)
        else { return nil }
        copy.frameLength = buffer.frameLength

        let source = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
        let destination = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
        guard source.count == destination.count else { return nil }
        for index in 0..<source.count {
            let from = source[index]
            let to = destination[index]
            guard
                let bytes = from.mData,
                let room = to.mData,
                to.mDataByteSize >= from.mDataByteSize
            else { return nil }
            memcpy(room, bytes, Int(from.mDataByteSize))
        }
        return copy
    }

    /// One microphone buffer into the analyzer, in the format it named.
    ///
    /// Called from the tap on the audio thread and from the hand-over on the
    /// start task, never from both at once — see `buffering`.
    private func feed(_ buffer: AVAudioPCMBuffer) {
        guard
            let converter = converter,
            let format = analyzerFormat,
            let continuation = inputContinuation
        else { return }

        let ratio = format.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 1024
        guard let converted = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else {
            return
        }

        var conversionError: NSError?
        var delivered = false
        let status = converter.convert(to: converted, error: &conversionError) { _, outStatus in
            // One tap buffer per call: after handing it over, tell the converter
            // there is nothing more right now rather than blocking for more.
            if delivered {
                outStatus.pointee = .noDataNow
                return nil
            }
            delivered = true
            outStatus.pointee = .haveData
            return buffer
        }

        if status == .error {
            if !loggedConversionFailure {
                loggedConversionFailure = true
                let detail = conversionError.map { DictationError.describe($0) } ?? "no detail"
                NSLog("RP-DICT audio conversion failed: %@", detail)
            }
            return
        }
        guard converted.frameLength > 0 else { return }
        continuation.yield(AnalyzerInput(buffer: converted))
    }

    /// Linear RMS over the raw microphone samples, before conversion, mapped to
    /// the 0..1 the meter wants. A linear bar would sit near the floor for a
    /// normal speaking voice, so this is in dB.
    private func emitLevel(_ buffer: AVAudioPCMBuffer) {
        let now = CFAbsoluteTimeGetCurrent()
        guard now - lastLevelAt >= Self.levelInterval else { return }
        lastLevelAt = now

        guard let channels = buffer.floatChannelData else { return }
        let frames = Int(buffer.frameLength)
        guard frames > 0 else { return }

        let samples = channels[0]
        var sum: Float = 0
        for index in 0..<frames {
            let value = samples[index]
            sum += value * value
        }
        let rms = (sum / Float(frames)).squareRoot()
        let db = 20 * log10(max(rms, 1e-7))
        let scaled = (db - Self.quietDb) / (Self.loudDb - Self.quietDb)
        let value = Double(min(max(scaled, 0), 1))
        NSLog("RP-DICT level rms=%.6f db=%.1f value=%.3f", Double(rms), Double(db), value)
        send(["kind": "level", "value": value])
    }

    // MARK: - Results

    private func startConsumingResults(from transcriber: SpeechTranscriber) {
        resultsTask = Task { [weak self] in
            do {
                for try await result in transcriber.results {
                    self?.handle(result)
                }
            } catch {
                NSLog("RP-DICT the results stream failed: %@", DictationError.describe(error))
                self?.recordFailure("Dictation stopped unexpectedly.")
            }
            self?.resultsGate.signal()
        }
    }

    /// volatile vs final is `result.isFinal` and nothing else — one stream, one
    /// event. The tail is what is beyond the last final, never the cumulative
    /// utterance: the webview renders `finals.join(...) + volatile`, so a
    /// cumulative tail would double-count everything already settled.
    private func handle(_ result: SpeechTranscriber.Result) {
        let text = String(result.text.characters)
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)

        transcriptLock.lock()
        if result.isFinal {
            // A final drops the tail whether or not it carries text: the
            // hypothesis it replaces is settled either way.
            if !trimmed.isEmpty { finals.append(trimmed) }
            volatileTail = ""
        } else {
            volatileTail = trimmed
        }
        transcriptLock.unlock()

        // Shape and timing, never the words. The plist promises the user their
        // speech "is transcribed on this iPhone and never uploaded", and a
        // sysdiagnose is an upload — one they are routinely asked for by support
        // and by Feedback Assistant. There is deliberately no compile-time or
        // runtime switch here that could put the text back: the measurement
        // builds that need it get it from scripts/ios-dictation/measurement-patch.py,
        // which rewrites this call in the Mac's working tree and is never
        // committed. A flag in this file would be one `#if` away from shipping.
        NSLog(
            "RP-DICT %@ %.0fms %d chars",
            result.isFinal ? "final" : "volatile",
            (CFAbsoluteTimeGetCurrent() - startedAt) * 1000, text.count)

        if result.isFinal {
            // Always: a final is what the webview appends, and it also clears
            // the tail, so dropping one loses words.
            lastVolatileAt = 0
            send(["kind": "final", "text": text])
            return
        }
        let now = CFAbsoluteTimeGetCurrent()
        guard now - lastVolatileAt >= Self.volatileInterval else { return }
        lastVolatileAt = now
        send(["kind": "volatile", "text": text])
    }

    // MARK: - Permission

    private func ensureMicrophonePermission() async throws {
        switch AVAudioApplication.shared.recordPermission {
        case .granted:
            return
        case .denied:
            throw DictationError("Microphone access is off. Turn it on in Settings.")
        case .undetermined:
            // The alert steals the touch, so this hold is lost whatever happens
            // — the pointer is cancelled and the composer cancels the run. Ask
            // anyway, so the next hold works, and say a sentence instead of
            // nothing.
            _ = await withCheckedContinuation {
                (continuation: CheckedContinuation<Bool, Never>) in
                AVAudioApplication.requestRecordPermission { granted in
                    continuation.resume(returning: granted)
                }
            }
            throw DictationError("Microphone access is needed. Press and hold again.")
        @unknown default:
            throw DictationError("Microphone access is off. Turn it on in Settings.")
        }
    }

    // MARK: - Timing

    /// Every step this hold reached, for the plugin to hand to the webview once
    /// the run is down. Read after stop(), so the teardown's own steps are in
    /// it; safe on a run whose start threw, which is the case where the missing
    /// steps are the answer.
    func timingReport() -> DictationTiming {
        timing.snapshot(profile: profile)
    }

    private func mark(_ step: String, since start: CFAbsoluteTime) {
        timing.mark(step, since: start)
    }

    /// A step of the teardown, measured from the release. Kept apart from the
    /// ones above because it has a different zero.
    private func markTeardown(_ step: String, since start: CFAbsoluteTime) {
        timing.markTeardown(step, since: start)
    }
}
