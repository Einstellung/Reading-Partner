// One hold of the dictation bar: microphone in, transcript events out, and the
// whole transcript back at the end.
//
// The chain, in the order start() builds it (docs/33, ASR and AEC 与音频路由):
//
//   AVAudioSession(.playAndRecord, .voiceChat)   the mode the voice-processing
//                                                IO unit requires
//   AVAudioEngine.inputNode                      with setVoiceProcessingEnabled,
//                                                so the echo canceller's
//                                                reference signal is by
//                                                construction whatever this app
//                                                plays
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
// Order matters more than the drawing suggests. setVoiceProcessingEnabled
// rebuilds the IO unit, and a rebuilt unit answers questions about the hardware
// with AVAudioEngine's defaults — 44100 Hz stereo — until the engine has been
// prepared. Every format used here is one the engine reported, never one this
// file chose, and the two reads of the microphone format are compared before a
// tap is installed with either of them.
//
// A run is single-use. Once stopped, or once the audio session is interrupted,
// it is dead: iOS refuses to restart recording from the background (docs/33),
// so nothing here tries. Its transcript outlives the capture, though — an
// interruption or the backstop tears the microphone down and keeps the words,
// so the stop_dictation that follows still has something to answer with.

import AVFoundation
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
    /// a fourth kind leaves it holding `undefined` and the next event throws
    /// inside a callback nothing catches.
    typealias Emit = (JSObject) -> Void

    private let emit: Emit
    private let engine = AVAudioEngine()

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
    private var tapInstalled = false

    private var stopping = false
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
    /// arguing from the requested one (docs/pitfall/140).
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
    private static let quietDb: Float = -50
    private static let loudDb: Float = -10

    private let startedAt = CFAbsoluteTimeGetCurrent()
    /// A conversion failure repeats on every buffer; one line says it.
    private var loggedConversionFailure = false
    /// Press-to-first-buffer is the number hold-to-talk lives or dies on, and
    /// the tap is the only place that knows it happened.
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

    init(emit: @escaping Emit) {
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

        let locale = try await resolveLocale(requested)
        mark("locale", since: t0)

        let transcriber = makeTranscriber(locale: locale)
        self.transcriber = transcriber

        // The model lives in system storage, outside the app, and the system
        // drops it again after long disuse — so this asks every run rather than
        // assuming (docs/33). A first-ever hold pays a download here.
        try await installModelIfNeeded(for: transcriber, locale: locale)
        mark("model", since: t0)

        try configureSession()
        observeSessionNotifications()
        mark("session", since: t0)

        // Before any format is read anywhere: enabling it on the input node
        // turns the whole IO unit into a voice-processing one and rebuilds it.
        let input = engine.inputNode
        do {
            try input.setVoiceProcessingEnabled(true)
        } catch {
            throw DictationError(
                "The microphone could not be prepared: \(DictationError.describe(error))")
        }

        let analyzerFormat = try await resolveAnalyzerFormat(for: transcriber)
        self.analyzerFormat = analyzerFormat
        mark("analyzerFormat", since: t0)

        // Read after the session is active and voice processing is decided:
        // both change what the input node reports.
        let hardwareFormat = input.outputFormat(forBus: 0)
        NSLog(
            "RP-DICT formats analyzer=%@ microphone=%@",
            Self.describe(analyzerFormat), Self.describe(hardwareFormat))
        guard hardwareFormat.sampleRate > 0 else {
            throw DictationError(
                "The microphone did not open. The audio session never became active.")
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

        // Last read of the microphone format, and the one the tap is installed
        // with. A tap whose format disagrees with the node it sits on does not
        // fail: it is simply never called. If the graph moved between the two
        // reads, refuse — a hold that captures nothing is worse than one that
        // never starts.
        let tapFormat = input.outputFormat(forBus: 0)
        guard tapFormat.isEqual(hardwareFormat) else {
            throw DictationError(
                "The microphone changed format while it was being opened, from "
                    + "\(Self.describe(hardwareFormat)) to \(Self.describe(tapFormat)).")
        }
        input.installTap(onBus: 0, bufferSize: 4096, format: tapFormat) {
            [weak self] buffer, _ in
            self?.consume(buffer)
        }
        tapInstalled = true

        engine.prepare()
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
                    + "\(Self.describe(engine.outputNode.inputFormat(forBus: 0))) while its "
                    + "hardware is \(Self.describe(engine.outputNode.outputFormat(forBus: 0))) and "
                    + "the session runs at \(AVAudioSession.sharedInstance().sampleRate) Hz.")
        }

        startBackstop()
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

        if tapInstalled {
            engine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        if engine.isRunning {
            engine.stop()
        }

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
        mark("finalized", since: t0)

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
        mark("results", since: t0)

        do {
            try AVAudioSession.sharedInstance().setActive(
                false, options: [.notifyOthersOnDeactivation])
        } catch {
            NSLog("RP-DICT deactivate failed: %@", DictationError.describe(error))
        }
        mark("stopped", since: t0)
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

    private func configureSession() throws {
        let session = AVAudioSession.sharedInstance()
        do {
            // .voiceChat is the mode the voice-processing unit wants, and it
            // sets HFP itself, so no Bluetooth option here.
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker])
            try session.setActive(true)
        } catch {
            throw DictationError(
                "The microphone is in use by something else: \(DictationError.describe(error))")
        }
    }

    private func resolveAnalyzerFormat(for transcriber: SpeechTranscriber) async throws
        -> AVAudioFormat
    {
        guard let best = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber])
        else {
            throw DictationError("The recognizer would not name an audio format it accepts.")
        }
        return best
    }

    private static func describe(_ format: AVAudioFormat) -> String {
        "\(Int(format.sampleRate))Hz \(format.channelCount)ch "
            + "\(format.isInterleaved ? "interleaved" : "deinterleaved") "
            + "fmt=\(format.commonFormat.rawValue)"
    }

    // MARK: - Notifications

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
            ) { _ in
                let route = AVAudioSession.sharedInstance().currentRoute
                NSLog(
                    "RP-DICT route in=[%@] out=[%@]",
                    route.inputs.map { $0.portType.rawValue }.joined(separator: ", "),
                    route.outputs.map { $0.portType.rawValue }.joined(separator: ", "))
            })

        // The engine posts this when the hardware format changes under it, and
        // it stops itself on the way. It is the one event that explains a hold
        // that started without an error and captured nothing.
        notificationObservers.append(
            center.addObserver(
                forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
            ) { [weak self] _ in
                guard let self = self else { return }
                NSLog(
                    "RP-DICT the engine reconfigured itself; running=%d",
                    self.engine.isRunning ? 1 : 0)
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
            // The frame count is here because pitfall 140 argued from 4096 and
            // the arithmetic did not match the measurement: 4096 at 48 kHz
            // predicts 11.7 Hz and twelve holds read 9.6-10.0. installTap's
            // bufferSize is a request, not a contract, and nothing had ever
            // logged what was actually delivered.
            NSLog(
                "RP-DICT firstBuffer +%.0fms frames=%u rate=%.0f",
                (firstBufferAt - pressedAt) * 1000,
                buffer.frameLength,
                buffer.format.sampleRate)
        }
        emitLevel(buffer)

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

    private func mark(_ step: String, since start: CFAbsoluteTime) {
        NSLog("RP-DICT %@ +%.0fms", step, (CFAbsoluteTimeGetCurrent() - start) * 1000)
    }
}
